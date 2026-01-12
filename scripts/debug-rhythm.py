#!/usr/bin/env python3
"""
Sherlock Report Generator v12 (The Corrected Core)
- Goal: Extract RAW, UNBIASED musical features.
- Fixes: Separated 'Beat' vs 'Downbeat' confidence.
- Bands: Low (Bass), Mid (Vocals/Guitar), High (Guira).
"""

import sys
import os
import json
import warnings
import collections
import collections.abc
import numpy as np

# --- 1. COMPATIBILITY PATCHES (Do not touch) ---
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

# Check for Madmom
try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
except ImportError as e:
    print(f"Error: madmom is required. Install it via pip. ({e})", file=sys.stderr)
    sys.exit(1)

# ==========================================
# 2. SIGNAL PROCESSING HELPERS
# ==========================================

def get_rms_at_time(y, sr, time_sec, window_sec=0.1):
    """Calculates RMS Energy (Loudness) around a specific timestamp."""
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    
    if start >= end: return 0.0
    chunk = y[start:end]
    # Add epsilon to avoid division by zero later
    return float(np.sqrt(np.mean(chunk**2))) + 1e-9

def get_flatness_at_time(y, sr, time_sec, window_sec=0.1):
    """Calculates Spectral Flatness (0.0=Tone/Music, 1.0=Noise/Percussion)."""
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    
    if start >= end: return 0.0
    chunk = y[start:end]
    
    n_fft = min(512, len(chunk))
    if n_fft == 0: return 0.0
    
    flatness = librosa.feature.spectral_flatness(y=chunk, n_fft=n_fft)
    return float(np.mean(flatness))

# ==========================================
# 3. MAIN ANALYSIS LOGIC
# ==========================================

def generate_sherlock_report(audio_path):
    print(f"[Sherlock v12] Analyzing: {audio_path}...", file=sys.stderr)
    
    # --- A. Load Audio ---
    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
    except Exception as e:
        raise ValueError(f"Failed to load audio: {e}")

    # --- B. Frequency Separation (The 3-Band EQ) ---
    print(f"[Sherlock] Applying Frequency Filters...", file=sys.stderr)
    
    # 1. High Pass (Guira Range: > 4000 Hz)
    sos_high = signal.butter(6, 4000, 'high', fs=sr, output='sos')
    y_high = signal.sosfilt(sos_high, y)

    # 2. Band Pass (Mid Range: 300 - 2500 Hz -> Vocals & Guitar Body)
    sos_mid = signal.butter(6, [300, 2500], 'band', fs=sr, output='sos')
    y_mid = signal.sosfilt(sos_mid, y)

    # 3. Low Pass (Bass Range: < 200 Hz)
    sos_bass = signal.butter(6, 200, 'low', fs=sr, output='sos')
    y_bass = signal.sosfilt(sos_bass, y)

    # 4. HPSS (Percussive vs Harmonic Separation)
    y_harmonic, y_percussive = librosa.effects.hpss(y, margin=3.0)

    # --- C. Rhythm Analysis (Madmom) ---
    print(f"[Sherlock] Running Madmom RNN...", file=sys.stderr)
    
    # 1. Создаем временный файл безопасным для Windows способом
    fd, tmp_path = tempfile.mkstemp(suffix='.wav')
    os.close(fd) # <--- ВАЖНО: Сразу закрываем дескриптор, чтобы файл был свободен
    
    try:
        # 2. Записываем аудио в закрытый файл
        sf.write(tmp_path, y, sr)
        
        # 3. Запускаем Madmom
        proc = RNNDownBeatProcessor()
        act = proc(tmp_path) 
        
        rnn_fps = 100.0
        beat_processor = DBNBeatTrackingProcessor(fps=rnn_fps)
        beat_times = beat_processor(act[:, 0]) 
        all_beats = [float(b) for b in beat_times]
        
    finally:
        # 4. Удаляем файл (теперь он точно не занят)
        try:
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception as e:
            print(f"Warning: Could not delete temp file {tmp_path}: {e}", file=sys.stderr)

    # --- D. BPM Estimate ---
    bpm_rounded = 0
    if len(all_beats) > 1:
        intervals = np.diff(all_beats)
        bpm_val = 60.0 / np.mean(intervals)
        bpm_rounded = int(round(bpm_val))

    # --- E. Feature Extraction Loop ---
    print(f"[Sherlock] Extracting feature dossier...", file=sys.stderr)
    
    raw_data = {
        "bass": [], "mid": [], "high": [],
        "perc": [], "harm": [], "flat": [],
        "beat_conf": [], "downbeat_conf": []
    }

    for t in all_beats:
        # 1. Spectral Energies (RMS)
        raw_data["bass"].append(get_rms_at_time(y_bass, sr, t))
        raw_data["mid"].append(get_rms_at_time(y_mid, sr, t))
        raw_data["high"].append(get_rms_at_time(y_high, sr, t))
        
        # 2. HPSS Energies
        raw_data["perc"].append(get_rms_at_time(y_percussive, sr, t))
        raw_data["harm"].append(get_rms_at_time(y_harmonic, sr, t))
        
        # 3. Complexity/Texture
        raw_data["flat"].append(get_flatness_at_time(y, sr, t))
        
        # 4. Madmom Confidence Lookup
        frame = int(t * rnn_fps)
        if frame < len(act):
            raw_data["beat_conf"].append(float(act[frame, 0]))     # Any beat
            raw_data["downbeat_conf"].append(float(act[frame, 1])) # The "1"
        else:
            raw_data["beat_conf"].append(0.0)
            raw_data["downbeat_conf"].append(0.0)

    # --- F. Normalization (0.0 - 1.0) ---
    # We find the max value for each band to scale the graph nicely
    max_vals = {}
    for key in raw_data:
        if "conf" in key: continue # Do not normalize probabilities (they are 0-1)
        mx = max(raw_data[key]) if raw_data[key] else 1.0
        max_vals[key] = mx if mx > 0 else 1.0

    # --- G. Construct Final Dossier ---
    dossier = []
    
    for i, t in enumerate(all_beats):
        
        # HPSS Ratio calculation
        p_val = raw_data["perc"][i]
        h_val = raw_data["harm"][i]
        hpss_ratio = p_val / (h_val + 1e-9)

        dossier.append({
            "index": i,
            "time": round(t, 3),
            "rhythm": {
                "beat_prob": round(raw_data["beat_conf"][i], 3),     # Is it a beat?
                "downbeat_prob": round(raw_data["downbeat_conf"][i], 3) # Is it a "1"?
            },
            "bands": {
                "low": round(raw_data["bass"][i] / max_vals["bass"], 3),
                "mid": round(raw_data["mid"][i] / max_vals["mid"], 3),
                "high": round(raw_data["high"][i] / max_vals["high"], 3),
            },
            "texture": {
                "hpss_ratio": round(hpss_ratio, 3),
                "flatness": round(raw_data["flat"][i], 4)
            }
        })

    return {
        "bpm": bpm_rounded,
        "total_beats": len(dossier),
        "dossier": dossier
    }

# ==========================================
# 4. ENTRY POINT
# ==========================================
def main():
    if len(sys.argv) < 2:
        print("Usage: python sherlock_v12.py <audio_file> [output_file]", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    
    if len(sys.argv) >= 3:
        output_path = sys.argv[2]
    else:
        # Auto-name output if not provided
        dir_name = os.path.dirname(audio_path)
        base_name = os.path.splitext(os.path.basename(audio_path))[0]
        output_path = os.path.join(dir_name, f"{base_name}_v12.json")
    
    try:
        report = generate_sherlock_report(audio_path)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)
        print(f"Success! Analysis saved to: {output_path}")
    except Exception as e:
        print(f"CRITICAL ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()