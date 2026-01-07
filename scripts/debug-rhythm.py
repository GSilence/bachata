#!/usr/bin/env python3
"""
Sherlock Report Generator v2
- Исправлен BPM (median interval)
- Добавлен анализ High Freq (Percussion/Guira)
- Добавлена эвристика поиска "The Drop" (вступление баса)
- Исправлена совместимость с NumPy 1.24+ (np.int patch)
"""

import sys
import os
import json
import warnings

# --- 1. CRITICAL PATCHES (MUST BE BEFORE IMPORTS) ---
import collections
import collections.abc
import numpy as np

# Patch Collections for Python 3.10+
if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence

# Patch NumPy for Madmom (np.int, np.float deprecated in 1.20+)
with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'):
        np.float = np.float64
    if not hasattr(np, 'int'):
        np.int = np.int64  # <--- ВОТ ЭТО ЛЕЧИТ ОШИБКУ
    if not hasattr(np, 'bool'):
        np.bool = bool

# --- 2. NOW IMPORT LIBRARIES ---
import librosa
from scipy import signal

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
    sos_bass = signal.butter(6, 200, 'low', fs=sr, output='sos')
    y_bass = signal.sosfilt(sos_bass, y)
    
    # Mid: 200 - 5000 Hz
    sos_mid = signal.butter(6, [200, 5000], 'band', fs=sr, output='sos')
    y_mid = signal.sosfilt(sos_mid, y)

    # High (Percussion/Guira): > 5000 Hz
    sos_high = signal.butter(6, 5000, 'high', fs=sr, output='sos')
    y_high = signal.sosfilt(sos_high, y)
    
    return y_bass, y_mid, y_high

def find_energy_drop_index(dossier):
    """
    Ищет индекс, где начинается стабильный бас (The Drop).
    Логика: Найти первый бит, где Bass > 0.45 (относительный) 
    И следующие 3 бита тоже имеют Bass > 0.35 (чтобы исключить случайный всплеск).
    """
    for i in range(len(dossier) - 4):
        curr = dossier[i]['features']['rel_bass']
        # Проверяем "поддержку" следующими 3 битами (чтобы убедиться, что бас не пропал)
        support = sum(dossier[j]['features']['rel_bass'] for j in range(i+1, i+4)) / 3
        
        # Пороги подобраны эмпирически для бачаты
        if curr > 0.40 and support > 0.35:
            return i
            
    # Если явного дропа нет, возвращаем 0 (начало трека)
    return 0

# ==========================================
# Main
# ==========================================

def generate_sherlock_report(audio_path):
    print(f"[Sherlock] Analyzing: {audio_path}...", file=sys.stderr)
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    
    # Madmom Analysis
    proc = RNNDownBeatProcessor()
    act = proc(audio_path)
    
    # Используем FPS=100 (стандарт Madmom RNN)
    rnn_fps = 100.0
    
    beat_processor = DBNBeatTrackingProcessor(fps=rnn_fps)
    beat_times = beat_processor(act[:, 0])
    
    # Accurate BPM Calculation (Median)
    if len(beat_times) > 1:
        intervals = np.diff(beat_times)
        median_interval = np.median(intervals)
        bpm = int(round(60.0 / median_interval))
    else:
        bpm = 120
    
    print(f"[Sherlock] BPM: {bpm}", file=sys.stderr)

    # Filters
    print(f"[Sherlock] Filtering audio frequencies...", file=sys.stderr)
    y_bass, y_mid, y_high = apply_filters(y, sr)
    
    # Calculate Maxima for Normalization
    raw_bass_vals = []
    raw_mid_vals = []
    raw_high_vals = []
    raw_vol_vals = []
    
    for t in beat_times:
        raw_bass_vals.append(get_rms_at_time(y_bass, sr, t))
        raw_mid_vals.append(get_rms_at_time(y_mid, sr, t))
        raw_high_vals.append(get_rms_at_time(y_high, sr, t))
        raw_vol_vals.append(get_rms_at_time(y, sr, t))
        
    max_bass = max(raw_bass_vals) if raw_bass_vals else 1.0
    max_mid = max(raw_mid_vals) if raw_mid_vals else 1.0
    max_high = max(raw_high_vals) if raw_high_vals else 1.0
    max_vol = max(raw_vol_vals) if raw_vol_vals else 1.0

    # Build Dossier
    dossier = []
    for i, t in enumerate(beat_times):
        frame = int(t * rnn_fps)
        madmom_prob = float(act[frame, 1]) if frame < len(act) else 0.0
        
        dossier.append({
            "index": i,
            "time": round(float(t), 2),
            "madmom_prob": round(madmom_prob, 4),
            "features": {
                "rel_bass": round(raw_bass_vals[i] / max_bass, 4),
                "rel_mid": round(raw_mid_vals[i] / max_mid, 4),
                "rel_high": round(raw_high_vals[i] / max_high, 4),
                "rel_vol": round(raw_vol_vals[i] / max_vol, 4)
            }
        })

    # Predict The Drop (Anchor Point)
    drop_index = find_energy_drop_index(dossier)
    print(f"[Sherlock] Detected Drop at Index: {drop_index} (Time: {dossier[drop_index]['time']}s)", file=sys.stderr)
    
    # Calculate Predicted Counts relative to the Drop
    # Drop index is ALWAYS considered Count 1 of a Phrase
    for item in dossier:
        # Расстояние от дропа в битах
        dist = item['index'] - drop_index
        
        # Математика счета 1-8
        # Если dist = 0 -> (0 % 8) + 1 = 1
        # Если dist = -1 -> (-1 % 8) + 1 = 7 + 1 = 8 (Работает верно!)
        # Если dist = -4 -> (-4 % 8) + 1 = 4 + 1 = 5
        count_1_8 = (dist % 8) + 1
        
        item['predicted_count'] = count_1_8

    report = {
        "bpm": bpm,
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
        print("Usage: python generate-sherlock.py <audio_file> [output_file]", file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    # Автоматическое имя выходного файла, если не задано
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
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()