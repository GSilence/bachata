#!/usr/bin/env python3
"""
Умный анализ ритма с использованием Madmom.
Версия:
1. BPM: STRICT MEAN (Среднее арифметическое интервалов) - самый точный метод для 131 vs 130.
2. Offset: Smart Bass Drop + Neural Validation.
3. Grid: Back-calculation.
4. FPS: 100 (Native).
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
    Ищет "The Drop" с валидацией через нейросеть.
    """
    n = len(bass_values)
    if n == 0: return 0
    
    max_val = max(bass_values) if max(bass_values) > 0 else 1.0
    norm_bass = [v / max_val for v in bass_values]
    
    for i in range(n - 8): 
        curr = norm_bass[i]
        support = sum(norm_bass[j] for j in range(i+1, i+4)) / 3
        
        if curr > 0.45 and support > 0.35:
            # Валидация нейросетью
            lookahead = min(n, i + 16)
            local_probs = beat_probs[i:lookahead]
            
            if not local_probs or max(local_probs) < 0.2:
                print(f"[SmartDrop] Madmom silent, trusting bass at {i}", file=sys.stderr)
                # Check attack
                if i > 0:
                     prev = norm_bass[i-1]
                     if prev > 0.15 and prev > (norm_bass[i-2] * 2.0 if i>1 else 0):
                         return i - 1
                return i
            
            max_prob_idx_rel = np.argmax(local_probs)
            max_prob_idx_abs = i + max_prob_idx_rel
            dist = max_prob_idx_abs - i
            
            if dist % 4 == 0:
                print(f"[SmartDrop] Confirmed candidate {i} by Madmom peak at {max_prob_idx_abs}", file=sys.stderr)
                if i > 0:
                     prev = norm_bass[i-1]
                     if prev > 0.15 and prev > (norm_bass[i-2] * 2.0 if i>1 else 0):
                         return i - 1
                return i
            else:
                print(f"[SmartDrop] Candidate {i} REJECTED. Misaligned (Dist {dist})", file=sys.stderr)
                continue

    return 0


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
            
            # ТРЕКЕР БИТОВ: FPS=200 для точности оффсета
            print(f"Step 2: Tracking beats (fps=200)...", file=sys.stderr)
            beat_processor = DBNBeatTrackingProcessor(fps=200)
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
            # 1. Считаем Mean Interval (Главный авторитет)
            if len(all_beats) > 1:
                intervals = np.diff(all_beats)
                avg_interval = np.mean(intervals) 
                bpm_mean = 60.0 / avg_interval
            else:
                bpm_mean = 120.0

            # 2. Считаем Global Tempo (только для проверки октавы)
            tempo_proc = TempoEstimationProcessor(fps=100, min_bpm=60, max_bpm=190)
            tempos = tempo_proc(act)
            bpm_global = tempos[0][0] if len(tempos) > 0 else bpm_mean

            # 3. Проверяем Октаву (Double/Half check)
            # Если Mean=65, а Global=130, то умножаем Mean на 2.
            # Если Mean=130, а Global=130, то оставляем Mean.
            
            ratio = bpm_global / bpm_mean
            if 1.8 < ratio < 2.2:
                print(f"[Analysis] Correction: Doubling BPM (Mean {bpm_mean:.2f} -> Global {bpm_global:.2f})", file=sys.stderr)
                bpm_mean *= 2
            elif 0.4 < ratio < 0.6:
                print(f"[Analysis] Correction: Halving BPM (Mean {bpm_mean:.2f} -> Global {bpm_global:.2f})", file=sys.stderr)
                bpm_mean /= 2
            
            # 4. ФИНАЛ: Всегда берем Mean
            bpm = int(round(bpm_mean))
            print(f"[Analysis] Final BPM: {bpm} (Raw Mean: {bpm_mean:.4f})", file=sys.stderr)

        except Exception as e:
            print(f"[Analysis] Warning: BPM calc failed ({e}), using simple median", file=sys.stderr)
            if len(all_beats) > 1:
                bpm = round(60.0 / np.mean(np.diff(all_beats)))
            else:
                bpm = 120

        # 4. Offset
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
            
        drop_index = find_smart_drop_index(bass_values, beat_probs)
        print(f"[Analysis] Drop found at beat index: {drop_index} (Time: {all_beats[drop_index]:.3f}s)", file=sys.stderr)
        
        # 5. Grid
        first_one_index = drop_index % 8
        offset = all_beats[first_one_index]
        print(f"[Analysis] Calculated Offset: {offset:.3f}s (Index {first_one_index})", file=sys.stderr)

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