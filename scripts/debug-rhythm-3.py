#!/usr/bin/env python3
"""
Sherlock v3.02 (High-Fidelity Global Grid)
------------------------------------------
1. AUDIO ENGINE: Switches to Native Sampling Rate (sr=None).
   - Prev: 22050Hz -> Cutoff at 11kHz.
   - Now: 44100Hz/48000Hz -> Full spectrum up to 22kHz.
   - Result: Much sharper detection of High-Frequency percussion (Bongo Taps).

2. LOGIC ENGINE: "Global Grid Strategy" (v3.01 logic).
   - We calculate statistics for ALL 8 possible start offsets (0..7).
   - The offset with the highest Hit Rate (Madmom > 0.3 or Bass > 0.45) wins.
   - Tie-breaker: The earliest offset wins.

3. DATA ENGINE: Added extra spectral features (Spectral Contrast, Rolloff).
"""

import sys
import os
import glob
import json
import warnings
import numpy as np
import tempfile
import uuid
import collections
import collections.abc

# Fix for Python 3.10+ collections import
if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence

with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'): np.float = np.float64
    if not hasattr(np, 'int'): np.int = np.int64

import librosa
from scipy import signal
import soundfile as sf

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
except ImportError as e:
    print(f"Error: madmom is required. ({e})", file=sys.stderr)
    sys.exit(1)

# --- ADVANCED SIGNAL PROCESSING ---

def get_rms(chunk):
    if len(chunk) == 0: return 0.0
    return float(np.sqrt(np.mean(chunk**2)))

def get_band_energy(y, sr, time_sec, freq_range, window_sec=0.08): # Чуть уменьшил окно для резкости
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    chunk = y[start:end]
    if len(chunk) < 50: return get_rms(chunk)
    
    sos = None
    # Используем фильтры 4-го порядка для чистого разделения
    if freq_range[0] and freq_range[1]:
        sos = signal.butter(4, [freq_range[0], freq_range[1]], btype='band', fs=sr, output='sos')
    elif freq_range[0]:
        sos = signal.butter(4, freq_range[0], btype='high', fs=sr, output='sos')
    elif freq_range[1]:
        sos = signal.butter(4, freq_range[1], btype='low', fs=sr, output='sos')
        
    if sos is not None:
        return get_rms(signal.sosfilt(sos, chunk))
    return get_rms(chunk)

def get_spectral_features(y, sr, time_sec, window_sec=0.1):
    """
    Новая функция для извлечения дополнительных данных о тембре.
    """
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0, 0.0, 0.0
    
    chunk = y[start:end]
    n_fft = min(1024, len(chunk))
    if n_fft == 0: return 0.0, 0.0, 0.0
    
    # 1. Flatness (Шумоподобность: 1.0 = белый шум, 0.0 = синусоида)
    flat = float(np.mean(librosa.feature.spectral_flatness(y=chunk, n_fft=n_fft)))
    
    # 2. Spectral Rolloff (Где заканчиваются высокие частоты, яркость звука)
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=chunk, sr=sr, n_fft=n_fft, roll_percent=0.85)))
    
    # 3. Zero Crossing Rate (Перкуссивность / Шумность)
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(chunk)))
    
    return flat, rolloff, zcr

def analyze_track(audio_path, output_path=None):
    if not output_path:
        base, _ = os.path.splitext(audio_path)
        output_path = base + "_sherlock_v3.02.json"
        
    print(f"\n[Sherlock v3.02] 💎 High-Fidelity Grid: {os.path.basename(audio_path)}")
    
    tmp_filename = f"sherlock_{uuid.uuid4().hex}.wav"
    tmp_path = os.path.join(tempfile.gettempdir(), tmp_filename)
    
    try:
        # === ВНЕДРЕНИЕ 1: NATIVE SAMPLING RATE ===
        # sr=None заставляет Librosa читать файл "как есть" (обычно 44100 или 48000 Hz)
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        
        # Разделение на Гармонику и Перкуссию (полезно для отделения мелодии от ритма)
        y_harm, y_perc = librosa.effects.hpss(y, margin=1.0)
        
        # Сохраняем временный файл для Madmom (она сама переварит любой SR)
        sf.write(tmp_path, y, sr)
        
        # Запуск нейросети Madmom
        rnn_proc = RNNDownBeatProcessor()
        activations = rnn_proc(tmp_path) 
        beat_proc = DBNBeatTrackingProcessor(fps=100) # Grid is still 10ms (standard)
        beat_times = beat_proc(activations[:, 0])
        all_beats = [float(b) for b in beat_times]
        
        if not all_beats: return

        beats_data = []
        # Статистика для отслеживания скачков
        prev_stats = {"low": 0.0, "mid": 0.0, "high": 0.0, "total": 0.0}
        
        for i, t in enumerate(all_beats):
            # Извлекаем энергию в диапазонах (с учетом высокого SR)
            e_low = get_band_energy(y, sr, t, (None, 200))    # Bass
            e_mid = get_band_energy(y, sr, t, (200, 2000))    # Mids (Voice/Guitar)
            e_high = get_band_energy(y, sr, t, (4000, None))  # Highs (Shakers/Bongo Slap)
            e_total = get_band_energy(y, sr, t, (None, None))
            
            # Дополнительные метрики (Новое исследование!)
            flat, rolloff, zcr = get_spectral_features(y, sr, t)
            
            # Соотношение Гармоники и Перкуссии
            # (Если Perc >> Harm -> это удар барабана. Если Harm >> Perc -> это нота баса)
            e_harm = get_rms(get_band_energy(y_harm, sr, t, (None, None), window_sec=0.08)) # хак, используем get_band_energy как slice
            e_perc = get_rms(get_band_energy(y_perc, sr, t, (None, None), window_sec=0.08))
            
            # Madmom confidence
            frame_idx = min(int(t * 100), len(activations)-1)
            prob_downbeat = float(activations[frame_idx, 1])
            
            # BPM calculation
            delta_time = 0.0
            local_bpm = 0.0
            if i > 0:
                delta_time = t - all_beats[i-1]
                if delta_time > 0: local_bpm = 60.0 / delta_time

            # Changes percent
            def pct(curr, prev): 
                if prev < 1e-6: return 0.0
                return ((curr - prev)/prev)*100
            
            diffs = {
                "low": pct(e_low, prev_stats['low']),
                "mid": pct(e_mid, prev_stats['mid']),
                "high": pct(e_high, prev_stats['high']),
                "total": pct(e_total, prev_stats['total'])
            }
            prev_stats = {"low": e_low, "mid": e_mid, "high": e_high, "total": e_total}

            beats_data.append({
                "id": i, "time": t,
                "low": e_low, "mid": e_mid, "high": e_high, "total": e_total,
                "harm": e_harm, "perc": e_perc,
                "flat": flat, "rolloff": rolloff, "zcr": zcr, # <-- Новые данные
                "madmom_score": prob_downbeat,
                "delta": delta_time, "bpm": local_bpm,
                "diffs": diffs
            })

        # Нормализация (0.0 - 1.0)
        limit_idx = min(len(beats_data), 100) # Нормализуем по первым 100 битам (интро+куплет)
        max_vals = {}
        # Добавляем новые поля в нормализацию
        keys_to_norm = ['low', 'mid', 'high', 'total', 'harm', 'perc', 'rolloff', 'zcr'] 
        
        for k in keys_to_norm:
            vals = [b[k] for b in beats_data[:limit_idx]]
            m = max(vals) if vals else 1.0
            max_vals[k] = m if m > 0 else 1.0

        for b in beats_data:
            for k in max_vals:
                b[f"norm_{k}"] = round(b[k] / max_vals[k], 3)

        # === ВНЕДРЕНИЕ 2: GLOBAL GRID LOGIC (v3.01 CORE) ===
        
        candidates = []
        total_beats = len(beats_data)
        
        # Пороги для "Сильного бита"
        MADMOM_THRESHOLD = 0.30
        BASS_THRESHOLD = 0.45 
        
        # Проверяем 8 гипотез (смещения 0..7)
        for offset in range(8):
            grid_indices = range(offset, total_beats, 4)
            hits = 0
            checks_count = 0
            total_madmom_energy = 0
            
            for idx in grid_indices:
                if idx >= len(beats_data): break
                beat = beats_data[idx]
                
                m_score = beat['madmom_score']
                b_score = beat['norm_low']
                
                total_madmom_energy += m_score
                
                # Попадание: Либо Нейросеть уверена, Либо Бас мощный
                if m_score > MADMOM_THRESHOLD or b_score > BASS_THRESHOLD:
                    hits += 1
                
                checks_count += 1
            
            match_percent = (hits / checks_count * 100) if checks_count > 0 else 0.0
            avg_energy = (total_madmom_energy / checks_count) if checks_count > 0 else 0.0
            
            candidates.append({
                "offset": offset,
                "match_percent": round(match_percent, 2),
                "avg_madmom": round(avg_energy, 4),
                "hits": hits,
                "total_checks": checks_count
            })
            
        # Выбор победителя: Макс %, при равенстве - самый ранний (меньший offset)
        sorted_candidates = sorted(candidates, key=lambda x: (-x['match_percent'], x['offset']))
        winner = sorted_candidates[0]
        final_start_beat = beats_data[winner['offset']]
        
        print(f"   >>> VERDICT: Start at Beat {winner['offset']} ({final_start_beat['time']:.2f}s)")
        print(f"   >>> CONFIDENCE: {winner['match_percent']}% (SR: {sr}Hz)")

        # Формирование отчета
        final_beats_export = []
        for b in beats_data:
            final_beats_export.append({
                "id": b['id'],
                "time": round(b['time'], 3),
                "is_start": (b['id'] == final_start_beat['id']),
                "madmom_score_1": round(b['madmom_score'], 4),
                "energy_stats": {
                    "low": b['norm_low'], "mid": b['norm_mid'], "high": b['norm_high'], 
                    "total_mix": b['norm_total'], 
                    "flatness": round(b['flat'], 4),
                    "rolloff": b['norm_rolloff'], # NEW: Яркость
                    "zcr": b['norm_zcr']          # NEW: Шумность/Атака
                },
                "decomposition": {
                    "harmonic": b['norm_harm'], "percussive": b['norm_perc'],
                    "perc_harm_ratio": round(b['perc']/(b['harm']+0.0001), 2)
                },
                "change_vs_prev_pct": {
                    "low": round(b['diffs']['low'], 1), "mid": round(b['diffs']['mid'], 1),
                    "high": round(b['diffs']['high'], 1), "total": round(b['diffs']['total'], 1)
                },
                "timing": {
                    "delta": round(b['delta'], 3), "bpm": int(b['bpm'])
                }
            })
            
        report = {
            "meta": {
                "filename": os.path.basename(audio_path),
                "duration": round(duration, 2),
                "sample_rate": sr,  # <-- Важно видеть SR
                "total_beats": len(final_beats_export),
                "avg_bpm": int(np.mean([x['bpm'] for x in beats_data if x['bpm']>0])) if beats_data else 0
            },
            "verdict": {
                "algo_version": "v3.02 (High-Fi Global Grid)",
                "start_beat_id": final_start_beat['id'],
                "start_time": round(final_start_beat['time'], 3),
                "confidence": winner['match_percent'],
                "grid_candidates": candidates
            },
            "beats": final_beats_export
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)
            
    except Exception as e:
        print(f"[Error] {e}")
        import traceback
        traceback.print_exc()
    finally:
        if os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except: pass

def main():
    if len(sys.argv) < 2:
        print("Usage: python sherlock_v3_02.py <file>")
        sys.exit(1)
    path = sys.argv[1]
    if os.path.isdir(path):
        for f in glob.glob(os.path.join(path, "*.mp3")): analyze_track(f)
    else:
        analyze_track(path)

if __name__ == '__main__':
    main()