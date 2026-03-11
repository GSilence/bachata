#!/usr/bin/env python3
"""
generate-waveform.py — Generate normalized RMS waveform peaks for audio visualization.

Usage:
    python generate-waveform.py <audio_path> [n_peaks]

Output (stdout):
    JSON: {"peaks": [0.0..1.0, ...], "count": N}

Peaks are normalized to [0, 1] with sqrt compression so quiet parts
remain visible (similar to how Soundcloud renders waveforms).
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

    # Compute RMS energy using librosa (vectorized, fast)
    frame_length = max(256, len(y) // n_peaks)
    hop_length = max(128, len(y) // n_peaks)
    rms = librosa.feature.rms(y=y, frame_length=frame_length, hop_length=hop_length)[0]

    # Resample to exactly n_peaks via linear interpolation
    if len(rms) != n_peaks:
        x_old = np.linspace(0, 1, len(rms))
        x_new = np.linspace(0, 1, n_peaks)
        rms = np.interp(x_new, x_old, rms)

    # Normalize to [0, 1]
    max_val = float(np.max(rms))
    if max_val > 0:
        rms = rms / max_val

    # sqrt compression: makes quiet parts more visible (perceptual loudness)
    rms = np.sqrt(rms)

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
