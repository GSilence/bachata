#!/usr/bin/env python3
"""
Sherlock Report Generator v9 (HPSS Edition)
- Logic: Standard Madmom + HPSS Separation
- Goal: Check if 'Percussive' energy helps identify the true drop vs intro.
"""

import sys
import os
import json
import warnings
import collections
import collections.abc
import numpy as np

if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence

with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'): np.float = np.float64
    if not hasattr(np, 'int'): np.int = np.int64
    if not hasattr(np, 'bool'): np.bool = bool

import librosa
from scipy import signal
import soundfile as sf
import tempfile

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
except ImportError as e:
    print(f"Error: madmom is required: {e}", file=sys.stderr)
    sys.exit(1)

# ==========================================
# Helpers
# ==========================================

def get_rms_at_time(y, sr, time_sec, window_sec=0.05):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    chunk = y[start:end]
    return float(np.sqrt(np.mean(chunk**2)))

def generate_sherlock_report(audio_path):
    print(f"[Sherlock] Analyzing: {audio_path}...", file=sys.stderr)
    
    # 1. Loading
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    
    # --- HPSS SEPARATION ---
    print(f"[Sherlock] Running HPSS separation...", file=sys.stderr)
    # y_harmonic нам не нужен, берем только y_percussive
    _, y_percussive = librosa.effects.hpss(y, margin=3.0)
    
    # 2. Madmom (Standard)
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
        tmp_path = tmp_file.name
    sf.write(tmp_path, y, sr)
    
    try:
        proc = RNNDownBeatProcessor()
        act = proc(tmp_path)
        rnn_fps = 100.0
        beat_processor = DBNBeatTrackingProcessor(fps=rnn_fps)
        beat_times = beat_processor(act[:, 0])
        all_beats = [float(b) for b in beat_times]
    finally:
        try: os.unlink(tmp_path)
        except: pass

    # 3. BPM
    bpm_rounded = 120
    if len(all_beats) > 1:
        intervals = np.diff(all_beats)
        bpm_val = 60.0 / np.mean(intervals)
        bpm_rounded = int(round(bpm_val))

    # 4. Features (Adding Percussive RMS)
    print(f"[Sherlock] Extracting features...", file=sys.stderr)
    
    raw_bass = []
    raw_perc = [] # <--- New Feature
    raw_vol = []
    beat_probs = []
    
    # Bass filter (как раньше)
    try:
        sos_bass = signal.butter(6, 200, 'low', fs=sr, output='sos')
        y_bass = signal.sosfilt(sos_bass, y)
    except: y_bass = y

    for i, t in enumerate(all_beats):
        raw_bass.append(get_rms_at_time(y_bass, sr, t))
        raw_perc.append(get_rms_at_time(y_percussive, sr, t)) # Читаем из HPSS слоя
        raw_vol.append(get_rms_at_time(y, sr, t))
        
        frame = int(t * rnn_fps)
        prob = float(act[frame, 1]) if frame < len(act) else 0.0
        beat_probs.append(prob)
        
    max_bass = max(raw_bass) if raw_bass and max(raw_bass) > 0 else 1.0
    max_perc = max(raw_perc) if raw_perc and max(raw_perc) > 0 else 1.0 # Нормализация перкуссии
    max_vol = max(raw_vol) if raw_vol and max(raw_vol) > 0 else 1.0

    # Dossier
    dossier = []
    for i, t in enumerate(all_beats):
        dossier.append({
            "index": i,
            "time": round(t, 3),
            "madmom_prob": round(beat_probs[i], 4),
            "features": {
                "rel_bass": round(raw_bass[i] / max_bass, 4),
                "rel_perc": round(raw_perc[i] / max_perc, 4), # <--- ВОТ ЧТО НАМ ВАЖНО
                "rel_vol": round(raw_vol[i] / max_vol, 4)
            }
        })

    return {
        "bpm": bpm_rounded,
        "dossier": dossier
    }

def main():
    if len(sys.argv) < 2:
        print("Usage: python debug-rhythm.py <audio_file> [output_file]", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        dir_name = os.path.dirname(audio_path)
        base_name = os.path.splitext(os.path.basename(audio_path))[0]
        output_path = os.path.join(dir_name, f"{base_name}_sherlock.json")
    
    try:
        report = generate_sherlock_report(audio_path)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)
        print(f"Report saved: {output_path}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()