#!/usr/bin/env python3
"""
Sherlock — Deep Bridge/Break Detection via Source Separation.

Uses Spleeter (4stems) to separate audio into Vocals, Bass, Drums, Other,
then detects structural anomalies ("Bridges", "Breaks", "Yamas") by analyzing
energy drops across stems.

The "Sherlock Trio" algorithm:
  1. Bass "Hole" — bass disappears and returns (classic Parada)
  2. Other "Hole" — accompaniment disappears and returns
  3. Vocal "Dropoff" — vocals disappear (don't need to return)
  If 2+ of these fire on the same window → ANOMALY

Usage:
    python analyze_bridge_spleeter.py <audio_path> <bpm> <offset> [threshold] [window_beats]

Args:
    audio_path: Path to audio file
    bpm:        BPM from main analysis
    offset:     True Start time in seconds
    threshold:  Sensitivity for energy drop (default: 0.15)
    window_beats: Window size in beats (default: 4)

Output: JSON to stdout
"""

import sys
import os
import json
import warnings
import traceback

warnings.filterwarnings("ignore")

# Suppress TensorFlow noise before any import
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'


def analyze_bridges(audio_path, bpm, offset, threshold=0.15, window_beats=4):
    """
    Main analysis: separate stems → compute per-window RMS → detect anomalies.
    """
    import numpy as np
    import librosa

    if not os.path.isfile(audio_path):
        return {"error": f"File not found: {audio_path}"}

    sr = 44100

    # ----------------------------------------------------------------
    # 1. LOAD AUDIO
    # ----------------------------------------------------------------
    print(f"[Sherlock] Loading audio: {audio_path}", file=sys.stderr)
    y, loaded_sr = librosa.load(audio_path, sr=sr, mono=False)
    # Ensure stereo (2, N)
    if y.ndim == 1:
        y = np.stack([y, y])
    duration = y.shape[1] / sr
    print(f"[Sherlock] Duration: {duration:.1f}s, BPM: {bpm}, Offset: {offset:.3f}s", file=sys.stderr)

    # ----------------------------------------------------------------
    # 2. SOURCE SEPARATION (Demucs in-memory)
    # ----------------------------------------------------------------
    stems = None
    try:
        import torch
        import torchaudio
        from demucs.pretrained import get_model
        from demucs.apply import apply_model

        print("[Sherlock] Demucs loaded, separating stems (this may take a moment)...", file=sys.stderr)
        model = get_model('htdemucs')
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
        model.to(device)

        # Demucs expects (batch, channels, samples) float32 tensor
        audio_tensor = torch.from_numpy(y).float().unsqueeze(0).to(device)  # (1, 2, N)

        with torch.no_grad():
            sources = apply_model(model, audio_tensor, device=device)
        # sources shape: (1, n_sources, 2, N)
        # htdemucs source order: drums, bass, other, vocals
        source_names = model.sources  # ['drums', 'bass', 'other', 'vocals']
        sources_np = sources.squeeze(0).cpu().numpy()  # (n_sources, 2, N)

        stem_dict = {}
        for i, name in enumerate(source_names):
            # (2, N) → (N, 2) for uniform processing
            stem_dict[name] = sources_np[i].T

        stems = {
            'vocals': stem_dict['vocals'],
            'bass': stem_dict['bass'],
            'other': stem_dict['other'],
        }
        separation_method = 'demucs'
        print(f"[Sherlock] Demucs separation complete ({device})", file=sys.stderr)

        # DEBUG: save stems to disk for listening
        try:
            import soundfile as sf
            reports_dir = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "public", "uploads", "reports"
            )
            os.makedirs(reports_dir, exist_ok=True)
            track_basename = os.path.splitext(os.path.basename(audio_path))[0]
            for stem_name, stem_data in stems.items():
                stem_file = os.path.join(reports_dir, f"{track_basename}_stem_{stem_name}.wav")
                sf.write(stem_file, stem_data, sr)
                print(f"[Sherlock] Saved stem: {stem_file}", file=sys.stderr)
        except Exception as e:
            print(f"[Sherlock] Stem save failed: {e}", file=sys.stderr)

    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        return {"error": f"Demucs separation failed: {str(e)}"}

    # ----------------------------------------------------------------
    # 3. GRID CONSTRUCTION — slice into beat windows
    # ----------------------------------------------------------------
    beat_duration = 60.0 / bpm  # seconds per beat
    window_duration = beat_duration * window_beats  # seconds per analysis window

    # Build windows starting from offset
    windows = []
    t = offset
    beat_idx = 0
    while t + window_duration <= duration + 0.1:  # small tolerance
        windows.append({
            'start': t,
            'end': min(t + window_duration, duration),
            'beat_index': beat_idx,
        })
        t += window_duration
        beat_idx += window_beats

    if len(windows) < 5:
        return {"error": f"Track too short for analysis: only {len(windows)} windows"}

    print(f"[Sherlock] {len(windows)} windows of {window_beats} beats ({window_duration:.2f}s each)", file=sys.stderr)

    # ----------------------------------------------------------------
    # 4. COMPUTE RMS ENERGY PER WINDOW PER STEM
    # ----------------------------------------------------------------
    def compute_rms(stem_data, start_sec, end_sec):
        """Compute RMS energy for a time slice of a stem (stereo → mono RMS)."""
        start_sample = int(start_sec * sr)
        end_sample = int(end_sec * sr)
        end_sample = min(end_sample, stem_data.shape[0])
        if start_sample >= end_sample:
            return 0.0
        chunk = stem_data[start_sample:end_sample]
        # Average channels → mono, then RMS
        mono = np.mean(chunk, axis=1) if chunk.ndim > 1 else chunk
        return float(np.sqrt(np.mean(mono ** 2)))

    stem_names = ['vocals', 'bass', 'other']
    # Energy arrays: stem → list of RMS per window
    energy = {stem: [] for stem in stem_names}
    for w in windows:
        for stem in stem_names:
            rms = compute_rms(stems[stem], w['start'], w['end'])
            energy[stem].append(rms)

    # Normalize each stem to 0-1 for visualization
    energy_norm = {}
    for stem in stem_names:
        arr = np.array(energy[stem])
        mx = np.max(arr)
        energy_norm[stem] = (arr / mx if mx > 0 else arr).tolist()

    # ----------------------------------------------------------------
    # 5. ANOMALY DETECTION — "Sherlock Trio" voting
    # ----------------------------------------------------------------
    anomalies = []
    ctx_size = 2  # look at 2 windows before and after

    # Absolute minimum energy to consider context "active"
    abs_threshold = 0.01

    for i in range(len(windows)):
        # Build left and right contexts
        left_indices = list(range(max(0, i - ctx_size), i))
        right_indices = list(range(i + 1, min(len(windows), i + ctx_size + 1)))

        if len(left_indices) < 1:
            continue  # skip very start

        votes = []
        vote_magnitudes = []

        for stem in stem_names:
            target_rms = energy[stem][i]
            left_rms = np.mean([energy[stem][j] for j in left_indices])
            right_rms = np.mean([energy[stem][j] for j in right_indices]) if right_indices else 0.0

            if stem in ('bass', 'other'):
                # "Hole" check: dip and return
                # Both contexts must be active
                if (left_rms > abs_threshold and right_rms > abs_threshold
                        and len(right_indices) >= 1):
                    ctx_mean = (left_rms + right_rms) / 2
                    if ctx_mean > 0 and target_rms < threshold * ctx_mean:
                        votes.append(stem)
                        vote_magnitudes.append(1.0 - (target_rms / ctx_mean))

            elif stem == 'vocals':
                # "Dropoff" check: disappears (don't care if returns)
                if left_rms > abs_threshold:
                    if left_rms > 0 and target_rms < threshold * left_rms:
                        votes.append(stem)
                        vote_magnitudes.append(1.0 - (target_rms / left_rms))

        # Consensus: 2+ votes = anomaly
        if len(votes) >= 2:
            w = windows[i]
            anomalies.append({
                'start_time': round(w['start'], 3),
                'end_time': round(w['end'], 3),
                'beat_index': w['beat_index'],
                'votes': votes,
                'confidence': round(float(np.mean(vote_magnitudes)), 4),
            })

    print(f"[Sherlock] Found {len(anomalies)} anomalies", file=sys.stderr)

    # ----------------------------------------------------------------
    # 6. MERGE adjacent anomalies into bridge regions
    # ----------------------------------------------------------------
    bridges = []
    if anomalies:
        current_bridge = {
            'start_time': anomalies[0]['start_time'],
            'end_time': anomalies[0]['end_time'],
            'beat_start': anomalies[0]['beat_index'],
            'beat_end': anomalies[0]['beat_index'] + window_beats,
            'windows': [anomalies[0]],
        }
        for a in anomalies[1:]:
            # If this anomaly is adjacent or overlapping with current bridge
            if a['start_time'] <= current_bridge['end_time'] + window_duration * 0.5:
                current_bridge['end_time'] = a['end_time']
                current_bridge['beat_end'] = a['beat_index'] + window_beats
                current_bridge['windows'].append(a)
            else:
                bridges.append(current_bridge)
                current_bridge = {
                    'start_time': a['start_time'],
                    'end_time': a['end_time'],
                    'beat_start': a['beat_index'],
                    'beat_end': a['beat_index'] + window_beats,
                    'windows': [a],
                }
        bridges.append(current_bridge)

    # Summarize bridges
    bridge_summary = []
    for b in bridges:
        all_votes = set()
        confidences = []
        for w in b['windows']:
            all_votes.update(w['votes'])
            confidences.append(w['confidence'])
        bridge_summary.append({
            'start_time': round(b['start_time'], 3),
            'end_time': round(b['end_time'], 3),
            'duration': round(b['end_time'] - b['start_time'], 3),
            'beat_start': b['beat_start'],
            'beat_end': b['beat_end'],
            'stems_triggered': sorted(all_votes),
            'confidence': round(float(np.mean(confidences)), 4),
        })

    # ----------------------------------------------------------------
    # 7. VISUALIZATION — save PNG
    # ----------------------------------------------------------------
    png_path = None
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        reports_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "public", "uploads", "reports"
        )
        os.makedirs(reports_dir, exist_ok=True)
        track_basename = os.path.splitext(os.path.basename(audio_path))[0]
        png_file = f"{track_basename}_bridges.png"
        png_full = os.path.join(reports_dir, png_file)

        fig, axes = plt.subplots(3, 1, figsize=(16, 6), dpi=100, sharex=True)
        fig.patch.set_facecolor('#1f2937')

        colors = {'bass': '#f59e0b', 'vocals': '#a78bfa', 'other': '#34d399'}
        titles = {'bass': 'Bass', 'vocals': 'Vocals', 'other': 'Other'}
        window_times = [(w['start'] + w['end']) / 2 for w in windows]

        for idx, stem in enumerate(stem_names):
            ax = axes[idx]
            ax.set_facecolor('#111827')
            ax.fill_between(window_times, energy_norm[stem],
                            color=colors[stem], alpha=0.4, step='mid')
            ax.plot(window_times, energy_norm[stem],
                    color=colors[stem], linewidth=1.2, drawstyle='steps-mid')

            # Mark anomaly windows for this stem
            for a in anomalies:
                if stem in a['votes']:
                    ax.axvspan(a['start_time'], a['end_time'],
                               color='#ef4444', alpha=0.25)

            # Mark bridge regions
            for b in bridge_summary:
                ax.axvspan(b['start_time'], b['end_time'],
                           color='#ef4444', alpha=0.1)
                if idx == 0:  # label only on top subplot
                    mid = (b['start_time'] + b['end_time']) / 2
                    ax.text(mid, 0.95, 'BRIDGE', ha='center', va='top',
                            fontsize=8, fontweight='bold', color='#ef4444',
                            transform=ax.get_xaxis_transform())

            ax.set_ylabel(titles[stem], color=colors[stem], fontsize=9)
            ax.set_ylim(0, 1.05)
            ax.tick_params(axis='x', colors='#9ca3af', labelsize=7)
            ax.tick_params(axis='y', colors='#9ca3af', labelsize=7)
            ax.spines['top'].set_visible(False)
            ax.spines['right'].set_visible(False)
            ax.spines['left'].set_color('#374151')
            ax.spines['bottom'].set_color('#374151')

        axes[-1].set_xlabel('Time (s)', color='#9ca3af', fontsize=9)
        fig.suptitle('Sherlock Bridge Detection — Stem Energy', color='#e5e7eb', fontsize=11)
        plt.tight_layout(pad=0.5)
        plt.savefig(png_full, facecolor='#1f2937', edgecolor='none')
        plt.close(fig)

        png_path = f"/uploads/reports/{png_file}"
        print(f"[Sherlock] Visualization saved: {png_full}", file=sys.stderr)
    except Exception as e:
        print(f"[Sherlock] Visualization failed: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)

    # ----------------------------------------------------------------
    # 8. BUILD STEMS ENERGY for frontend chart (low-res)
    # ----------------------------------------------------------------
    stems_energy = []
    for i, w in enumerate(windows):
        stems_energy.append({
            'time': round((w['start'] + w['end']) / 2, 3),
            'beat_index': w['beat_index'],
            'bass': round(energy_norm['bass'][i], 4),
            'vocals': round(energy_norm['vocals'][i], 4),
            'other': round(energy_norm['other'][i], 4),
        })

    return {
        'anomalies': anomalies,
        'bridges': bridge_summary,
        'bridges_count': len(bridge_summary),
        'total_windows': len(windows),
        'window_beats': window_beats,
        'threshold': threshold,
        'stems_energy': stems_energy,
        'visualization': png_path,
        'separation_method': separation_method,
    }


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({
            "error": "Usage: analyze_bridge_spleeter.py <audio_path> <bpm> <offset> [threshold] [window_beats]"
        }))
        sys.exit(1)

    audio_path = sys.argv[1]
    bpm = int(sys.argv[2])
    offset = float(sys.argv[3])
    threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.15
    window_beats = int(sys.argv[5]) if len(sys.argv) > 5 else 4

    result = analyze_bridges(audio_path, bpm, offset, threshold, window_beats)
    print(json.dumps(result, ensure_ascii=False))
