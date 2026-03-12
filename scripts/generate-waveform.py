#!/usr/bin/env python3
"""
generate-waveform.py — Generate normalized RMS waveform peaks for audio visualization.

Usage:
    python generate-waveform.py <audio_path> [n_peaks]

Output (stdout):
    JSON: {"peaks": [0.0..1.0, ...], "count": N}

Peaks are normalized to [0, 1]. Uses small RMS frames (~93ms) with max-pooling
when downsampling to n_peaks — preserves transients and amplitude variation.
"""

import sys
import json
import numpy as np
import librosa


def generate_waveform(audio_path: str, n_peaks: int = 200) -> list:
    # Load mono at 22050 Hz — sufficient for RMS envelope
    y, sr = librosa.load(audio_path, sr=22050, mono=True)

    if len(y) == 0:
        return []

    # Small fixed frames — preserves dynamics (~93ms window, ~23ms hop)
    frame_length = 2048
    hop_length = 512
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

    # Downsample to exactly n_peaks using max-pooling within each bucket.
    # Max (not mean/interp) preserves transient peaks → visible amplitude variation.
    n_frames = len(rms)
    peaks = []
    for i in range(n_peaks):
        start = int(i * n_frames / n_peaks)
        end = int((i + 1) * n_frames / n_peaks)
        end = max(end, start + 1)
        peaks.append(float(np.max(rms[start:end])))
    rms = np.array(peaks)

    # Normalize to [0, 1]
    max_val = float(np.max(rms))
    if max_val > 0:
        rms = rms / max_val

    # Light power compression (^0.7): wider dynamic range than sqrt (^0.5),
    # but still makes quiet parts visible. Produces bars from ~0.1 to 1.0.
    rms = np.power(rms, 0.7)

    return [round(float(v), 4) for v in rms]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: generate-waveform.py <audio_path> [n_peaks]"}))
        sys.exit(1)

    audio_path = sys.argv[1]
    n_peaks = int(sys.argv[2]) if len(sys.argv) > 2 else 200

    try:
        peaks = generate_waveform(audio_path, n_peaks)
        print(json.dumps({"peaks": peaks, "count": len(peaks)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
