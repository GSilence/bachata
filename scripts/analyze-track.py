#!/usr/bin/env python3
"""
Умный анализ ритма с использованием Madmom.
Версия:
1. BPM: STRICT MEAN (Dictatorship).
2. Offset: Combined Logic (Madmom Anchor + Bass Validation + Grid Lock).
3. Offset Shift: Time Projection to Start (Shift by 8 beats).
4. Grid: Based on Shifted Offset.
"""

import sys
import os
import json
import warnings

# --- 1. CRITICAL PATCHES ---
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
    from madmom.features.tempo import TempoEstimationProcessor
except ImportError as e:
    print(f"Error: madmom is required: {e}", file=sys.stderr)
    sys.exit(1)


# ==========================================
# HELPER FUNCTIONS
# ==========================================

def get_rms_at_time(y, sr, time_sec, window_sec=0.05):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    chunk = y[start:end]
    return float(np.sqrt(np.mean(chunk**2)))

def find_smart_drop_index(bass_values, beat_probs):
    """
    Новая логика поиска Offset (счета 1):
    1. Ищем 'Якорь' - первый бит с высокой уверенностью Madmom (prob > Threshold).
    2. Идем назад от Якоря и ищем вступление баса.
    3. Бас валидируется: это не просто щелчок, за ним следует энергия.
    4. Сетка валидируется: Якорь должен выпадать на 1 или 5 относительно найденного баса (Grid Lock).
    """
    n = len(bass_values)
    if n == 0: return 0

    # КОНСТАНТЫ
    CONFIDENCE_THRESHOLD = 0.3 
    
    # Нормализация баса для анализа
    max_bass = max(bass_values) if max(bass_values) > 0 else 1.0
    norm_bass = [v / max_bass for v in bass_values]
    
    # --- ШАГ 1: Поиск Якоря (Anchor) ---
    anchor_idx = -1
    for i in range(n):
        if beat_probs[i] > CONFIDENCE_THRESHOLD:
            anchor_idx = i
            print(f"[SmartDrop] Found Anchor at index {i} (Prob: {beat_probs[i]:.2f})", file=sys.stderr)
            break
            
    # Если уверенных битов нет вообще, берем просто самый вероятный во всем треке
    if anchor_idx == -1:
        anchor_idx = int(np.argmax(beat_probs))
        print(f"[SmartDrop] No strong anchor found. Using max probability index: {anchor_idx}", file=sys.stderr)

    # --- ШАГ 2: Поиск вступления (сканируем НАЗАД от якоря) ---
    found_bass_start = -1
    
    # Идем от якоря назад к началу
    for i in range(anchor_idx - 1, -1, -1):
        curr = norm_bass[i]
        prev = norm_bass[i-1] if i > 0 else 0.0
        
        # 2.1 Проверка на "Атаку"
        is_attack = (curr > 0.15) and (curr > prev * 1.5)
        
        if is_attack:
            # 2.2 Проверка "Не щелчок ли это?"
            check_len = min(3, n - 1 - i)
            if check_len > 0:
                future_energy = sum(norm_bass[i+1 : i+1+check_len]) / check_len
            else:
                future_energy = curr

            is_sustained = future_energy > 0.15
            
            if is_sustained:
                # 2.3 Проверка Сетки (Strict Grid Lock)
                # Расстояние между Anchor и Candidate
                dist = anchor_idx - i
                
                # FIX: Strict Grid Consistency.
                # dist % 4 == 0 счёт 1 (или 5).
                # Бачата считается на 8: 1,2,3,4,5,6,7,8 — смещение кратно 4.
                if dist % 4 == 0:
                    print(f"[SmartDrop] Found valid Bass Start at {i}. Dist to Anchor: {dist}. Bass: {curr:.2f}", file=sys.stderr)
                    found_bass_start = i
                    # Продолжаем искать более ранние вступления
                else:
                    pass

    # --- ШАГ 3: Принятие решения ---
    if found_bass_start != -1:
        return found_bass_start
    else:
        print(f"[SmartDrop] No valid bass intro found backwards (with grid lock). Using Anchor {anchor_idx} as start.", file=sys.stderr)
        return anchor_idx


# ==========================================
# MAIN ANALYSIS
# ==========================================

def analyze_track_with_madmom(audio_path, drums_path=None):
    try:
        # 1. Подготовка
        analysis_audio_path = drums_path if drums_path and os.path.exists(drums_path) else audio_path
        print(f"Using {'DRUMS' if analysis_audio_path == drums_path else 'ORIGINAL'} track", file=sys.stderr)
        
        y_analysis, sr = librosa.load(analysis_audio_path, sr=None, mono=True)
        if analysis_audio_path != audio_path:
             y_orig, sr_orig = librosa.load(audio_path, sr=None, mono=True)
        else:
             y_orig, sr_orig = y_analysis, sr
        duration = len(y_orig) / sr_orig
        print(f"Analyzing track: {audio_path}", file=sys.stderr)
        
        # 2. Madmom RNN
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        sf.write(tmp_path, y_analysis, sr)
        
        try:
            print("Step 1: Running RNNDownBeatProcessor...", file=sys.stderr)
            proc = RNNDownBeatProcessor()
            act = proc(tmp_path) 
            
            rnn_fps = 100.0
            
            # ТРЕКЕР БИТОВ: FPS=100
            print(f"Step 2: Tracking beats (fps=100)...", file=sys.stderr)
            beat_processor = DBNBeatTrackingProcessor(fps=100)
            beat_times = beat_processor(act[:, 0])
            all_beats = [float(b) for b in beat_times]
            
            # Вероятности для валидации
            beat_probs = []
            for t in all_beats:
                frame = int(t * rnn_fps) 
                if frame < len(act):
                    beat_probs.append(act[frame, 1])
                else:
                    beat_probs.append(0.0)
            
        finally:
            try: os.unlink(tmp_path)
            except: pass

        # 3. BPM (STRICT MEAN LOGIC)
        print("Step 3: Calculating Precise BPM (Strict Mean)...", file=sys.stderr)
        try:
            if len(all_beats) > 1:
                intervals = np.diff(all_beats)
                avg_interval = np.mean(intervals) 
                bpm_mean = 60.0 / avg_interval
            else:
                bpm_mean = 120.0

            # Проверка на удвоение
            tempo_proc = TempoEstimationProcessor(fps=100, min_bpm=60, max_bpm=190)
            tempos = tempo_proc(act)
            
            if len(tempos) > 0:
                bpm_global = tempos[0][0]
                ratio = bpm_global / bpm_mean
                
                if 1.8 < ratio < 2.2:
                    print(f"[Analysis] Correction: Doubling BPM (Mean {bpm_mean:.2f} -> ~{bpm_global:.2f})", file=sys.stderr)
                    bpm_mean *= 2
                elif 0.4 < ratio < 0.6:
                    print(f"[Analysis] Correction: Halving BPM (Mean {bpm_mean:.2f} -> ~{bpm_global:.2f})", file=sys.stderr)
                    bpm_mean /= 2
                else:
                    print(f"[Analysis] Keeping Mean BPM: {bpm_mean:.2f}", file=sys.stderr)

            bpm = int(round(bpm_mean))
            print(f"[Analysis] Final BPM: {bpm}", file=sys.stderr)

        except Exception as e:
            print(f"[Analysis] Warning: BPM calc failed ({e}), using simple median", file=sys.stderr)
            if len(all_beats) > 1:
                bpm = round(60.0 / np.mean(np.diff(all_beats)))
            else:
                bpm = 120

        # 4. Offset (New Combined Logic)
        print("Step 4: Detecting Offset (Anchor + Bass + Grid)...", file=sys.stderr)
        try:
            sos = signal.butter(6, 200, 'low', fs=sr_orig, output='sos')
            y_bass = signal.sosfilt(sos, y_orig)
        except:
            y_bass = y_orig
            
        bass_values = []
        for t in all_beats:
            val = get_rms_at_time(y_bass, sr_orig, t)
            bass_values.append(val)
            
        drop_index = find_smart_drop_index(bass_values, beat_probs)
        
        print(f"[Analysis] Drop found at beat index: {drop_index} (Time: {all_beats[drop_index]:.3f}s)", file=sys.stderr)
        
        # --- NEW LOGIC: SHIFT OFFSET TO START ---
        # Смещаем найденный Offset в начало трека шагами по 8 битов (1 фраза).
        # Цель: Найти самое раннее время, которое все еще >= 0, 
        # при этом сохраняя фазу найденного "Счета 1" (drop_index).
        
        found_offset = all_beats[drop_index]
        beat_interval = 60.0 / bpm
        section_duration = 8 * beat_interval
        
        shifted_offset = found_offset
        # Пока мы можем отступить назад на 8 битов и остаться в пределах трека (>= 0)
        while shifted_offset - section_duration >= 0.0:
            shifted_offset -= section_duration
            
        offset = shifted_offset
        print(f"[Analysis] Shifted Offset to Start: {offset:.3f}s (Original found at {found_offset:.3f}s)", file=sys.stderr)
        # ----------------------------------------

        print("Step 5: Generating Grid...", file=sys.stderr)
        # Grid generation now essentially starts from the shifted offset
        
        grid = []
        current_time = offset
        
        # Backwards loop (safety mostly, in case shifted_offset is > section_duration for some reason)
        while current_time > 0:
            current_time -= section_duration
            
        # Forwards to end
        while current_time < duration:
            end_time = current_time + section_duration
            if end_time > 0:
                start_display = round(current_time, 3)
                if start_display < 0 and start_display > -0.1:
                    start_display = 0.0
                grid.append({
                    "type": "verse",
                    "start": start_display,
                    "beats": 8
                })
            current_time += section_duration

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
        return {'bpm': 120, 'offset': 0.0, 'duration': 180, 'grid': [], 'error': str(e)}

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