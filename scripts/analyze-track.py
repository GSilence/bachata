#!/usr/bin/env python3
"""
Умный анализ ритма с использованием Madmom.
Версия:
1. BPM: Hybrid (RNN Intervals + Global Check) - максимальная точность
2. Offset: Smart Bass Drop (Attack detection) - исправляет фазу
3. Grid: Back-calculation from Drop - сетка с начала трека
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

# Patch NumPy for Madmom (np.int deprecated in 1.20+)
with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'):
        np.float = np.float64
    if not hasattr(np, 'int'):
        np.int = np.int64
    if not hasattr(np, 'bool'):
        np.bool = bool

# --- 2. IMPORTS ---
import librosa
from scipy import signal
import soundfile as sf
import tempfile

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
    from madmom.features.tempo import TempoEstimationProcessor
except ImportError as e:
    print(f"Error: madmom is required: {e}", file=sys.stderr)
    sys.exit(1)


# ==========================================
# HELPER FUNCTIONS
# ==========================================

def find_smart_drop_index(bass_values):
    """
    Ищет индекс бита, где происходит 'The Drop' (вступление баса).
    """
    n = len(bass_values)
    if n == 0: return 0
    
    max_val = max(bass_values) if max(bass_values) > 0 else 1.0
    norm_bass = [v / max_val for v in bass_values]
    
    anchor = 0
    found = False
    
    # 1. Ищем явное "Тело" баса
    for i in range(2, n - 4): 
        curr = norm_bass[i]
        support = sum(norm_bass[j] for j in range(i+1, i+4)) / 3
        
        if curr > 0.45 and support > 0.35:
            anchor = i
            found = True
            break
    
    if not found: return 0
    
    # 2. Проверяем "Атаку"
    prev = norm_bass[anchor - 1]
    pre_prev = norm_bass[anchor - 2]
    
    if prev > 0.15 and prev > (pre_prev * 2.0):
        print(f"[SmartDrop] Shifted anchor from {anchor} to attack at {anchor-1}", file=sys.stderr)
        return anchor - 1
        
    return anchor

def get_rms_at_time(y, sr, time_sec, window_sec=0.05):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    chunk = y[start:end]
    return float(np.sqrt(np.mean(chunk**2)))


# ==========================================
# MAIN ANALYSIS
# ==========================================

def analyze_track_with_madmom(audio_path, drums_path=None):
    try:
        # 1. Подготовка аудио
        analysis_audio_path = drums_path if drums_path and os.path.exists(drums_path) else audio_path
        print(f"Using {'DRUMS' if analysis_audio_path == drums_path else 'ORIGINAL'} track for rhythm analysis", file=sys.stderr)
        
        y_analysis, sr = librosa.load(analysis_audio_path, sr=None, mono=True)
        
        if analysis_audio_path != audio_path:
             y_orig, sr_orig = librosa.load(audio_path, sr=None, mono=True)
        else:
             y_orig, sr_orig = y_analysis, sr
             
        duration = len(y_orig) / sr_orig
        print(f"Analyzing track: {audio_path}", file=sys.stderr)
        
        # 2. Madmom Processing
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        sf.write(tmp_path, y_analysis, sr)
        
        try:
            print("Step 1: Running RNNDownBeatProcessor...", file=sys.stderr)
            proc = RNNDownBeatProcessor()
            act = proc(tmp_path)
            
            print("Step 2: Tracking beats (fps=200)...", file=sys.stderr)
            beat_processor = DBNBeatTrackingProcessor(fps=200)
            beat_times = beat_processor(act[:, 0])
            all_beats = [float(b) for b in beat_times]
            
        finally:
            try: os.unlink(tmp_path)
            except: pass

        # 3. Расчет BPM (HYBRID METHOD)
        # Мы доверяем интервалам нейросети (all_beats), так как они физически привязаны к сетке.
        # TempoEstimationProcessor используем для валидации.
        print("Step 3: Calculating Precise BPM...", file=sys.stderr)
        try:
            # А) Считаем точный средний интервал между битами
            if len(all_beats) > 1:
                intervals = np.diff(all_beats)
                # Используем MEAN (среднее), а не MEDIAN, чтобы учесть микро-сдвиги
                avg_interval = np.mean(intervals)
                bpm_from_intervals = 60.0 / avg_interval
            else:
                bpm_from_intervals = 120.0

            # Б) Спрашиваем "Профессора" (Глобальная оценка)
            tempo_proc = TempoEstimationProcessor(fps=100, min_bpm=60, max_bpm=190)
            tempos = tempo_proc(act)
            bpm_global = tempos[0][0] if len(tempos) > 0 else bpm_from_intervals

            # В) Логика объединения
            # Нормализуем глобальный BPM (90-180)
            if bpm_global < 90: bpm_global *= 2
            if bpm_global > 180: bpm_global /= 2
            
            # Если разница небольшая (< 3 BPM), верим ИНТЕРВАЛАМ, так как они точнее описывают сетку
            if abs(bpm_from_intervals - bpm_global) < 3.0:
                final_bpm_float = bpm_from_intervals
                source = "Interval Mean (Precise)"
            else:
                # Если разница большая (например, интервалы дали 65, а глобал 130), верим Глобалу
                final_bpm_float = bpm_global
                source = "TempoEstimation (Correction)"
            
            bpm = int(round(final_bpm_float))
            print(f"[Analysis] BPM Source: {source}. Value: {final_bpm_float:.2f} -> Rounded: {bpm}", file=sys.stderr)

        except Exception as e:
            print(f"[Analysis] Warning: BPM calc failed ({e}), using simple median", file=sys.stderr)
            if len(all_beats) > 1:
                bpm = round(60.0 / np.mean(np.diff(all_beats)))
            else:
                bpm = 120

        # 4. Поиск "The Drop"
        print("Step 4: Detecting Smart Bass Drop...", file=sys.stderr)
        try:
            sos = signal.butter(6, 200, 'low', fs=sr_orig, output='sos')
            y_bass = signal.sosfilt(sos, y_orig)
        except:
            y_bass = y_orig
            
        bass_values = []
        for t in all_beats:
            val = get_rms_at_time(y_bass, sr_orig, t)
            bass_values.append(val)
            
        drop_index = find_smart_drop_index(bass_values)
        print(f"[Analysis] Drop found at beat index: {drop_index} (Time: {all_beats[drop_index]:.3f}s)", file=sys.stderr)
        
        first_one_index = drop_index % 8
        offset = all_beats[first_one_index]
        print(f"[Analysis] Calculated Offset: {offset:.3f}s (Index {first_one_index})", file=sys.stderr)

        # 5. Генерация Сетки
        print("Step 5: Generating Grid...", file=sys.stderr)
        
        beat_interval = 60.0 / bpm
        section_beats = 8
        section_duration = section_beats * beat_interval
        
        grid = []
        current_time = offset
        
        while current_time > 0:
            current_time -= section_duration
            
        while current_time < duration:
            end_time = current_time + section_duration
            if end_time > 0:
                start_display = round(current_time, 3)
                if start_display < 0 and start_display > -0.1:
                    start_display = 0.0
                
                grid.append({
                    "type": "verse",
                    "start": start_display,
                    "beats": section_beats
                })
            current_time += section_duration

        # Dummy downbeats
        downbeats = []
        db_time = offset
        while db_time < duration:
            if db_time >= 0:
                downbeats.append(round(db_time, 3))
            db_time += beat_interval * 4

        result = {
            'bpm': bpm,
            'offset': round(offset, 3),
            'duration': duration,
            'grid': grid,
            'downbeats': downbeats,
            'totalBeats': len(all_beats)
        }
        
        return result

    except Exception as e:
        print(f"Error in analysis: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return {
            'bpm': 120, 'offset': 0.0, 'duration': 180,
            'grid': [{'type': 'verse', 'start': 0.0, 'beats': 32}],
            'error': str(e)
        }

def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Audio path required'}), file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    drums_path = None
    if len(sys.argv) >= 4 and sys.argv[2] == '--use-drums':
        drums_path = sys.argv[3]
    
    result = analyze_track_with_madmom(audio_path, drums_path)
    print(json.dumps(result))

if __name__ == '__main__':
    main()