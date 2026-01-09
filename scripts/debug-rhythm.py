#!/usr/bin/env python3
"""
Sherlock Report Generator v4 (Synced with Analyzer)
- Полная синхронизация ядра с analyze-track.py
- FPS: 100 (Native Madmom)
- BPM: Strict Mean
- Filters: Те же настройки фильтров
"""

import sys
import os
import json
import warnings

# --- 1. CRITICAL PATCHES (COPY FROM ANALYZER) ---
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

# --- 2. IMPORTS ---
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

def apply_filters(y, sr):
    # Bass: < 200 Hz
    try:
        sos_bass = signal.butter(6, 200, 'low', fs=sr, output='sos')
        y_bass = signal.sosfilt(sos_bass, y)
    except:
        y_bass = y

    # Mid: 200 - 5000 Hz
    try:
        sos_mid = signal.butter(6, [200, 5000], 'band', fs=sr, output='sos')
        y_mid = signal.sosfilt(sos_mid, y)
    except:
        y_mid = y

    # High: > 5000 Hz
    try:
        sos_high = signal.butter(6, 5000, 'high', fs=sr, output='sos')
        y_high = signal.sosfilt(sos_high, y)
    except:
        y_high = y
    
    return y_bass, y_mid, y_high

def find_energy_drop_index(dossier):
    """
    Простой поиск дропа для отчета (визуально).
    В анализаторе используется более сложная логика, здесь упрощенно для 'predicted_count'.
    """
    for i in range(len(dossier) - 4):
        curr = dossier[i]['features']['rel_bass']
        # Support logic
        support = sum(dossier[j]['features']['rel_bass'] for j in range(i+1, i+4)) / 3
        if curr > 0.45 and support > 0.35:
            return i
    return 0

# ==========================================
# Main
# ==========================================

def generate_sherlock_report(audio_path):
    print(f"[Sherlock] Analyzing: {audio_path}...", file=sys.stderr)
    
    # 1. Loading (Exactly as in Analyzer)
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    
    # 2. Madmom Analysis (Synced Logic)
    # Используем временный файл, как в анализаторе, для надежности
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
        tmp_path = tmp_file.name
    sf.write(tmp_path, y, sr)
    
    try:
        proc = RNNDownBeatProcessor()
        act = proc(tmp_path)
        
        # ВАЖНО: FPS=100 (Native) - как в analyze-track.py
        rnn_fps = 100.0
        
        beat_processor = DBNBeatTrackingProcessor(fps=rnn_fps)
        beat_times = beat_processor(act[:, 0])
        # Преобразуем в список float сразу, как в анализаторе
        all_beats = [float(b) for b in beat_times]
        
    finally:
        try: os.unlink(tmp_path)
        except: pass

    # 3. BPM Calculation (STRICT MEAN)
    if len(all_beats) > 1:
        intervals = np.diff(all_beats)
        avg_interval = np.mean(intervals) 
        bpm = int(round(60.0 / avg_interval))
    else:
        bpm = 120
    
    print(f"[Sherlock] BPM (Strict Mean): {bpm}", file=sys.stderr)

    # 4. Feature Extraction
    print(f"[Sherlock] Extracting features...", file=sys.stderr)
    y_bass, y_mid, y_high = apply_filters(y, sr)
    
    # Normalization Maxima
    raw_bass = []
    raw_mid = []
    raw_high = []
    raw_vol = []
    
    for t in all_beats:
        raw_bass.append(get_rms_at_time(y_bass, sr, t))
        raw_mid.append(get_rms_at_time(y_mid, sr, t))
        raw_high.append(get_rms_at_time(y_high, sr, t))
        raw_vol.append(get_rms_at_time(y, sr, t))
        
    max_bass = max(raw_bass) if raw_bass and max(raw_bass) > 0 else 1.0
    max_mid = max(raw_mid) if raw_mid and max(raw_mid) > 0 else 1.0
    max_high = max(raw_high) if raw_high and max(raw_high) > 0 else 1.0
    max_vol = max(raw_vol) if raw_vol and max(raw_vol) > 0 else 1.0

    # Build Dossier
    dossier = []
    for i, t in enumerate(all_beats):
        frame = int(t * rnn_fps)
        madmom_prob = float(act[frame, 1]) if frame < len(act) else 0.0
        
        dossier.append({
            "index": i,
            "time": round(t, 3), # Округляем до 3 знаков, как в анализаторе
            "madmom_prob": round(madmom_prob, 4),
            "features": {
                "rel_bass": round(raw_bass[i] / max_bass, 4),
                "rel_mid": round(raw_mid[i] / max_mid, 4),
                "rel_high": round(raw_high[i] / max_high, 4),
                "rel_vol": round(raw_vol[i] / max_vol, 4)
            }
        })

    # Drop Detection (Simplified for display)
    drop_index = find_energy_drop_index(dossier)
    
    # Structural Stats
    total_beats = len(dossier)
    total_eights = total_beats / 8.0

    # Counts prediction
    for item in dossier:
        dist = item['index'] - drop_index
        count_1_8 = (dist % 8) + 1
        item['predicted_count'] = count_1_8

    report = {
        "bpm": bpm,
        "structure": {
            "total_beats": total_beats,
            "total_eights": round(total_eights, 2)
        },
        "predicted_drop_index": drop_index,
        "predicted_drop_time": dossier[drop_index]['time'] if dossier else 0,
        "baselines": {
            "bass_max": max_bass,
            "total_max": max_vol
        },
        "dossier": dossier
    }
    
    return report

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