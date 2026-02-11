#!/usr/bin/env python3
"""
Sherlock — MSAF Structure Analysis
Detects structural boundaries (Verse, Chorus, Bridge/Parada, Break/Yamasi)
using Music Structure Analysis Framework (MSAF).

Usage:
    python analyze_structure_msaf.py <audio_path>

Output:
    JSON to stdout with detected sections.
    PNG visualization saved next to audio file.
"""

import sys
import os
import json
import warnings
import traceback

warnings.filterwarnings("ignore")


def analyze_structure(audio_path):
    """
    Main analysis using MSAF with fallback to pure-librosa approach.

    MSAF label interpretation:
      - Labels like "A", "B", "C" represent distinct musical sections.
      - Repeated labels (e.g., A-B-A-B) indicate recurring structure (e.g., Verse-Chorus-Verse-Chorus).
      - "A" is typically the first section encountered (often Intro or Verse).
      - A short section between two longer ones is likely a Bridge/Parada.

    Algorithm choice:
      - Foote: Checkerboard kernel on self-similarity matrix — best for boundary detection.
      - CNMF: Constrained NMF — good for both boundaries and labels.
      We try CNMF first (boundaries + labels), fall back to Foote (boundaries only),
      then fall back to pure-librosa if MSAF is unavailable.
    """

    import numpy as np

    # ---- Resolve audio path ----
    if not os.path.isfile(audio_path):
        return {"error": f"File not found: {audio_path}"}

    reports_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "public", "uploads", "reports"
    )
    os.makedirs(reports_dir, exist_ok=True)
    track_basename = os.path.splitext(os.path.basename(audio_path))[0]
    png_path = os.path.join(reports_dir, f"{track_basename}_structure.png")

    # ---- Try MSAF first ----
    msaf_available = False
    try:
        import msaf
        msaf_available = True
        print("[MSAF] Library loaded successfully", file=sys.stderr)
    except ImportError as e:
        print(f"[MSAF] Not available: {e}", file=sys.stderr)
        print("[MSAF] Falling back to librosa-based analysis", file=sys.stderr)
    except Exception as e:
        print(f"[MSAF] Load error: {e}", file=sys.stderr)

    sections = []
    algorithm_used = "none"

    if msaf_available:
        # --- Try CNMF (boundaries + labels) ---
        try:
            boundaries, labels = msaf.process(
                audio_path,
                boundaries_id="cnmf",
                labels_id="cnmf"
            )
            algorithm_used = "cnmf"
            print(f"[MSAF] CNMF: {len(boundaries)} boundaries, {len(labels)} labels", file=sys.stderr)
        except Exception as e:
            print(f"[MSAF] CNMF failed: {e}", file=sys.stderr)
            boundaries, labels = None, None

        # --- Fallback to Foote (boundaries only) ---
        if boundaries is None:
            try:
                boundaries, labels = msaf.process(
                    audio_path,
                    boundaries_id="foote",
                    labels_id=None
                )
                algorithm_used = "foote"
                # Generate auto-labels A, B, C...
                if labels is None or len(labels) == 0:
                    labels = list(range(len(boundaries) - 1))
                print(f"[MSAF] Foote: {len(boundaries)} boundaries", file=sys.stderr)
            except Exception as e:
                print(f"[MSAF] Foote failed: {e}", file=sys.stderr)
                boundaries, labels = None, None

        # --- Build sections from MSAF output ---
        if boundaries is not None and len(boundaries) >= 2:
            label_map = {}
            label_counter = 0
            for i in range(len(boundaries) - 1):
                raw_label = labels[i] if labels is not None and i < len(labels) else i
                if raw_label not in label_map:
                    label_map[raw_label] = chr(ord('A') + label_counter)
                    label_counter += 1
                sections.append({
                    "start_time": round(float(boundaries[i]), 3),
                    "end_time": round(float(boundaries[i + 1]), 3),
                    "label": label_map[raw_label],
                })

    # ---- Fallback: pure librosa-based structure analysis ----
    if not sections:
        try:
            import librosa
            algorithm_used = "librosa_novelty"

            print("[MSAF] Using librosa novelty-based fallback", file=sys.stderr)
            y, sr = librosa.load(audio_path, sr=22050, mono=True)
            duration = len(y) / sr

            # Compute features
            # MFCC-based self-similarity for structural boundaries
            mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=512)
            # Chroma for harmonic structure
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=512)
            # Combine features
            features = np.vstack([
                librosa.util.normalize(mfcc, axis=1),
                librosa.util.normalize(chroma, axis=1),
            ])

            # Self-similarity via recurrence matrix (downsampled to avoid OOM)
            # Use ~500 frames max
            hop_length = 512
            n_frames = features.shape[1]
            subsample = max(1, n_frames // 500)
            features_sub = features[:, ::subsample]

            # Novelty curve from checkerboard kernel on self-similarity
            from scipy.ndimage import uniform_filter1d
            from scipy.signal import find_peaks

            # Compute cosine similarity
            S = librosa.segment.recurrence_matrix(
                features_sub, mode='affinity', metric='cosine', sparse=False
            )
            # Checkerboard kernel novelty
            kernel_size = max(8, features_sub.shape[1] // 30)
            novelty = np.zeros(S.shape[0])
            half_k = kernel_size // 2
            for i in range(half_k, S.shape[0] - half_k):
                tl = S[i - half_k:i, i - half_k:i].mean()
                br = S[i:i + half_k, i:i + half_k].mean()
                tr = S[i - half_k:i, i:i + half_k].mean()
                bl = S[i:i + half_k, i - half_k:i].mean()
                novelty[i] = (tl + br) - (tr + bl)

            # Smooth and find peaks
            novelty_smooth = uniform_filter1d(novelty, size=3)
            # Dynamic threshold
            threshold = np.mean(novelty_smooth) + 0.5 * np.std(novelty_smooth)
            min_distance = max(3, int(8.0 / (subsample * hop_length / sr)))  # ~8 seconds apart

            peaks, _ = find_peaks(
                novelty_smooth,
                height=threshold,
                distance=min_distance
            )

            # Convert frame indices to times
            boundary_times = [0.0]
            for p in peaks:
                t = p * subsample * hop_length / sr
                if t > 2.0 and t < duration - 2.0:  # skip very start/end
                    boundary_times.append(round(t, 3))
            boundary_times.append(round(duration, 3))

            # Simple labeling based on feature similarity
            if len(boundary_times) >= 2:
                # Compute mean features per section for labeling
                section_features = []
                for i in range(len(boundary_times) - 1):
                    start_frame = int(boundary_times[i] * sr / hop_length)
                    end_frame = int(boundary_times[i + 1] * sr / hop_length)
                    end_frame = min(end_frame, features.shape[1])
                    if start_frame < end_frame:
                        section_features.append(np.mean(features[:, start_frame:end_frame], axis=1))
                    else:
                        section_features.append(np.zeros(features.shape[0]))

                # Cluster similar sections
                from scipy.spatial.distance import cosine as cosine_dist
                labels_arr = [-1] * len(section_features)
                current_label = 0
                similarity_threshold = 0.3  # cosine distance threshold

                for i in range(len(section_features)):
                    if labels_arr[i] >= 0:
                        continue
                    labels_arr[i] = current_label
                    for j in range(i + 1, len(section_features)):
                        if labels_arr[j] >= 0:
                            continue
                        dist = cosine_dist(section_features[i], section_features[j])
                        if dist < similarity_threshold:
                            labels_arr[j] = current_label
                    current_label += 1

                for i in range(len(boundary_times) - 1):
                    label_char = chr(ord('A') + labels_arr[i]) if labels_arr[i] < 26 else f"S{labels_arr[i]}"
                    sections.append({
                        "start_time": boundary_times[i],
                        "end_time": boundary_times[i + 1],
                        "label": label_char,
                    })

            print(f"[MSAF] Librosa fallback: {len(sections)} sections detected", file=sys.stderr)
        except Exception as e:
            print(f"[MSAF] Librosa fallback failed: {e}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            return {"error": f"Analysis failed: {str(e)}"}

    if not sections:
        return {
            "error": "No sections detected",
            "algorithm": algorithm_used,
            "sections": [],
        }

    # ---- Bridge heuristic ----
    # A section is a possible bridge if:
    # 1) Duration < 8 seconds OR exactly ~4 bars (at typical bachata ~130 BPM, 4 bars ≈ 7.4s)
    # 2) It sits between two longer sections
    # 3) Its label differs from neighbors
    for i, sec in enumerate(sections):
        sec_duration = sec["end_time"] - sec["start_time"]
        sec["duration"] = round(sec_duration, 3)
        sec["possible_bridge"] = False

        if sec_duration < 10.0 and 0 < i < len(sections) - 1:
            prev_dur = sections[i - 1]["end_time"] - sections[i - 1]["start_time"]
            next_dur = sections[i + 1]["end_time"] - sections[i + 1]["start_time"]
            # Short section between two longer ones
            if sec_duration < prev_dur * 0.6 and sec_duration < next_dur * 0.6:
                sec["possible_bridge"] = True
            # Different label from neighbors = transition
            if sec["label"] != sections[i - 1]["label"] and sec["label"] != sections[i + 1]["label"]:
                sec["possible_bridge"] = True

    # ---- Visualization ----
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches

        # Color palette for sections
        palette = [
            '#a78bfa', '#34d399', '#f59e0b', '#60a5fa', '#f472b6',
            '#fb923c', '#2dd4bf', '#a3e635', '#e879f9', '#fbbf24',
        ]
        label_colors = {}
        color_idx = 0

        fig, ax = plt.subplots(1, 1, figsize=(16, 3), dpi=100)
        fig.patch.set_facecolor('#1f2937')
        ax.set_facecolor('#111827')

        for sec in sections:
            lbl = sec["label"]
            if lbl not in label_colors:
                label_colors[lbl] = palette[color_idx % len(palette)]
                color_idx += 1
            color = label_colors[lbl]
            alpha = 0.4 if not sec["possible_bridge"] else 0.7

            ax.axvspan(sec["start_time"], sec["end_time"], color=color, alpha=alpha)
            mid = (sec["start_time"] + sec["end_time"]) / 2
            display_label = f"[{lbl}]" if sec["possible_bridge"] else lbl
            ax.text(mid, 0.5, display_label, ha='center', va='center',
                    fontsize=12, fontweight='bold', color='white',
                    transform=ax.get_xaxis_transform())

            # Section border
            ax.axvline(sec["start_time"], color='white', alpha=0.3, linewidth=0.5)

        # Format
        total_dur = sections[-1]["end_time"] if sections else 60
        ax.set_xlim(0, total_dur)
        ax.set_ylim(0, 1)
        ax.set_xlabel('Time (s)', color='#9ca3af', fontsize=9)
        ax.tick_params(axis='x', colors='#9ca3af', labelsize=8)
        ax.tick_params(axis='y', left=False, labelleft=False)
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['left'].set_visible(False)
        ax.spines['bottom'].set_color('#374151')
        ax.set_title('Structure Segmentation', color='#e5e7eb', fontsize=11, pad=8)

        # Legend
        legend_patches = []
        for lbl, col in label_colors.items():
            legend_patches.append(mpatches.Patch(color=col, alpha=0.5, label=f"Section {lbl}"))
        ax.legend(handles=legend_patches, loc='upper right', fontsize=8,
                  facecolor='#1f2937', edgecolor='#374151', labelcolor='#e5e7eb')

        plt.tight_layout(pad=0.5)
        plt.savefig(png_path, facecolor='#1f2937', edgecolor='none')
        plt.close(fig)
        print(f"[MSAF] Structure visualization saved: {png_path}", file=sys.stderr)
        structure_png = f"/uploads/reports/{track_basename}_structure.png"
    except Exception as e:
        print(f"[MSAF] Visualization failed: {e}", file=sys.stderr)
        structure_png = None

    # ---- Summary stats ----
    unique_labels = list(set(s["label"] for s in sections))
    bridges = [s for s in sections if s["possible_bridge"]]

    return {
        "algorithm": algorithm_used,
        "total_sections": len(sections),
        "unique_labels": sorted(unique_labels),
        "sections": sections,
        "bridges_detected": len(bridges),
        "structure_png": structure_png,
        "label_explanation": {
            "A": "First distinct section (usually Intro or Verse 1)",
            "B": "Second distinct section (usually Chorus or contrasting part)",
            "C": "Third distinct section (Bridge, Break, or new material)",
            "note": "Repeated labels (A-B-A-B) indicate recurring structure. "
                    "Sections marked possible_bridge=true are short transitions "
                    "between larger sections (Parada, Yamasi, Break)."
        }
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Audio path required"}), file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    result = analyze_structure(audio_path)
    print(json.dumps(result, ensure_ascii=False))
