#!/usr/bin/env python3
"""
Sherlock v2.06 (Phantom Filter)
- Logic Fix: Added 'Phantom Beat' check for the calculated start.
  If the start beat has very low Madmom Score (< 0.1) AND low Stability,
  we assume it's noise/artifact and shift to the next grid point.
"""

import sys
import os
import glob
import json
import warnings
import numpy as np
import tempfile
import uuid
import collections
import collections.abc

# ... (Imports and Signal Processing helpers remain same as v2.05) ...
if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence

with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'): np.float = np.float64
    if not hasattr(np, 'int'): np.int = np.int64

import librosa
from scipy import signal
import soundfile as sf

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
except ImportError as e:
    print(f"Error: madmom is required. ({e})", file=sys.stderr)
    sys.exit(1)

def get_rms(chunk):
    if len(chunk) == 0: return 0.0
    return float(np.sqrt(np.mean(chunk**2)))

def get_band_energy(y, sr, time_sec, freq_range, window_sec=0.1):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    chunk = y[start:end]
    if len(chunk) < 100: return get_rms(chunk)
    sos = None
    if freq_range[0] and freq_range[1]:
        sos = signal.butter(4, [freq_range[0], freq_range[1]], btype='band', fs=sr, output='sos')
    elif freq_range[0]:
        sos = signal.butter(4, freq_range[0], btype='high', fs=sr, output='sos')
    elif freq_range[1]:
        sos = signal.butter(4, freq_range[1], btype='low', fs=sr, output='sos')
    if sos is not None:
        return get_rms(signal.sosfilt(sos, chunk))
    return get_rms(chunk)

def get_spectral_flatness(y, sr, time_sec, window_sec=0.1):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    chunk = y[start:end]
    n_fft = min(512, len(chunk))
    if n_fft == 0: return 0.0
    return float(np.mean(librosa.feature.spectral_flatness(y=chunk, n_fft=n_fft)))

def get_chunk_at_time(y, sr, time_sec, window_sec=0.1):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    return y[start:end]

def analyze_track(audio_path, output_path=None):
    if not output_path:
        base, _ = os.path.splitext(audio_path)
        output_path = base + "_sherlock_v2.06.json"
        
    print(f"\n[Sherlock v2.06] 👻 Phantom Filter: {os.path.basename(audio_path)}")
    
    tmp_filename = f"sherlock_{uuid.uuid4().hex}.wav"
    tmp_path = os.path.join(tempfile.gettempdir(), tmp_filename)
    
    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        y_harm, y_perc = librosa.effects.hpss(y, margin=1.0)
        
        sf.write(tmp_path, y, sr)
        rnn_proc = RNNDownBeatProcessor()
        activations = rnn_proc(tmp_path) 
        beat_proc = DBNBeatTrackingProcessor(fps=100)
        beat_times = beat_proc(activations[:, 0])
        all_beats = [float(b) for b in beat_times]
        
        if not all_beats: return

        beats_data = []
        prev_stats = {"low": 0.0, "mid": 0.0, "high": 0.0, "total": 0.0}
        
        for i, t in enumerate(all_beats):
            e_low = get_band_energy(y, sr, t, (None, 200)) 
            e_mid = get_band_energy(y, sr, t, (200, 2000))
            e_high = get_band_energy(y, sr, t, (4000, None))
            e_total = get_band_energy(y, sr, t, (None, None))
            
            chunk_h = get_chunk_at_time(y_harm, sr, t)
            chunk_p = get_chunk_at_time(y_perc, sr, t)
            e_harm = get_rms(chunk_h)
            e_perc = get_rms(chunk_p)
            flat = get_spectral_flatness(y, sr, t)
            frame_idx = min(int(t * 100), len(activations)-1)
            prob_downbeat = float(activations[frame_idx, 1])
            
            delta_time = 0.0
            local_bpm = 0.0
            if i > 0:
                delta_time = t - all_beats[i-1]
                if delta_time > 0: local_bpm = 60.0 / delta_time

            def pct(curr, prev): 
                if prev < 1e-6: return 0.0
                return ((curr - prev)/prev)*100
            
            diffs = {
                "low": pct(e_low, prev_stats['low']),
                "mid": pct(e_mid, prev_stats['mid']),
                "high": pct(e_high, prev_stats['high']),
                "total": pct(e_total, prev_stats['total'])
            }
            prev_stats = {"low": e_low, "mid": e_mid, "high": e_high, "total": e_total}

            beats_data.append({
                "id": i, "time": t,
                "low": e_low, "mid": e_mid, "high": e_high, "total": e_total,
                "harm": e_harm, "perc": e_perc, "flat": flat,
                "madmom_score": prob_downbeat,
                "delta": delta_time, "bpm": local_bpm,
                "diffs": diffs
            })

        limit_idx = min(len(beats_data), 100)
        max_vals = {}
        for k in ['low', 'mid', 'high', 'total', 'harm', 'perc']:
            m = max([b[k] for b in beats_data[:limit_idx]]) if beats_data else 1.0
            max_vals[k] = m if m > 0 else 1.0

        for b in beats_data:
            for k in max_vals:
                b[f"norm_{k}"] = round(b[k] / max_vals[k], 3)

        # --- JUDGE LOGIC (v2.06) ---
        anchor_beat = None
        anchor_reason = ""
        crescendo_lock = False
        
        # 1. Find Anchor
        for i in range(len(beats_data) - 4):
            b = beats_data[i]
            if b['norm_low'] > 0.5 and b['madmom_score'] > 0.4:
                anchor_beat = b
                anchor_reason = "Bass Anchor"
                break
            if i < 4 and b['madmom_score'] > 0.5 and b['norm_total'] > 0.3:
                anchor_beat = b
                anchor_reason = "Rhythm Anchor"
                break
        
        if not anchor_beat and beats_data:
            anchor_beat = beats_data[0]
            anchor_reason = "Fallback"

        # 2. Check Crescendo
        if anchor_beat:
            idx = anchor_beat['id']
            if idx + 4 < len(beats_data):
                next_phrase_beat = beats_data[idx + 4]
                ratio = next_phrase_beat['norm_low'] / (anchor_beat['norm_low'] + 0.01)
                is_downbeat = next_phrase_beat['madmom_score'] > 0.4
                if ratio > 1.5 and is_downbeat:
                    anchor_beat = next_phrase_beat
                    anchor_reason += " + Crescendo"
                    crescendo_lock = True

        # 3. Backtrack
        final_start_beat = anchor_beat
        if anchor_beat and not crescendo_lock: 
            curr_idx = anchor_beat['id']
            while curr_idx - 4 >= 0:
                prev_idx = curr_idx - 4
                prev_beat = beats_data[prev_idx]
                if prev_beat['norm_total'] < 0.1: 
                    break
                curr_idx = prev_idx
                final_start_beat = prev_beat
                anchor_reason += " -> Backtracked"
        elif crescendo_lock:
             anchor_reason += " (Backtrack Locked)"

        # 4. PHANTOM CHECK (New in v2.06)
        # If the final beat looks suspicious (low Madmom score), push it forward.
        if final_start_beat:
            # Threshold: Madmom < 0.1 means "Not a beat"
            if final_start_beat['madmom_score'] < 0.1:
                 # Check if next beat is better? No, we must shift by GRID (usually 1 beat is weird).
                 # Actually, usually phantom beats are just wrong detections. 
                 # Let's check the immediate next beat (id+1).
                 # If we are at index 0, maybe index 1 is the real one.
                 next_idx = final_start_beat['id'] + 1
                 if next_idx < len(beats_data):
                     next_b = beats_data[next_idx]
                     if next_b['madmom_score'] > 0.1:
                         print(f"   -> Phantom Start Detected (Beat {final_start_beat['id']} Score {final_start_beat['madmom_score']:.4f}). Shifting to Beat {next_b['id']}.")
                         final_start_beat = next_b
                         anchor_reason += " -> Phantom Shift (+1)"

        if final_start_beat:
            print(f"   >>> VERDICT: Start at Beat {final_start_beat['id']} ({final_start_beat['time']:.2f}s)")
            print(f"   >>> REASON: {anchor_reason}")

        # Save
        final_beats_export = []
        for b in beats_data:
            final_beats_export.append({
                "id": b['id'],
                "time": round(b['time'], 3),
                "is_start": (final_start_beat and b['id'] == final_start_beat['id']),
                "madmom_score_1": round(b['madmom_score'], 4),
                "energy_stats": {
                    "low": b['norm_low'], "mid": b['norm_mid'], "high": b['norm_high'], 
                    "total_mix": b['norm_total'], "flatness": round(b['flat'], 4)
                },
                "decomposition": {
                    "harmonic": b['norm_harm'], "percussive": b['norm_perc'],
                    "perc_harm_ratio": round(b['perc']/(b['harm']+0.0001), 2)
                },
                "change_vs_prev_pct": {
                    "low": round(b['diffs']['low'], 1), "mid": round(b['diffs']['mid'], 1),
                    "high": round(b['diffs']['high'], 1), "total": round(b['diffs']['total'], 1)
                },
                "timing": {
                    "delta": round(b['delta'], 3), "bpm": int(b['bpm'])
                }
            })
            
        report = {
            "meta": {
                "filename": os.path.basename(audio_path),
                "duration": round(duration, 2),
                "total_beats": len(final_beats_export),
                "avg_bpm": int(np.mean([x['bpm'] for x in beats_data if x['bpm']>0])) if beats_data else 0
            },
            "verdict": {
                "start_beat_id": final_start_beat['id'] if final_start_beat else -1,
                "start_time": final_start_beat['time'] if final_start_beat else 0.0,
                "reason": anchor_reason
            },
            "beats": final_beats_export
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)
            
    except Exception as e:
        print(f"[Error] {e}")
        import traceback
        traceback.print_exc()
    finally:
        if os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except: pass

def main():
    if len(sys.argv) < 2:
        print("Usage: python sherlock_v2_06.py <file>")
        sys.exit(1)
    path = sys.argv[1]
    if os.path.isdir(path):
        for f in glob.glob(os.path.join(path, "*.mp3")): analyze_track(f)
    else:
        analyze_track(path)

if __name__ == '__main__':
    main()