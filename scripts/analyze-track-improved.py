#!/usr/bin/env python3
"""
Улучшенный анализ ритма для Бачаты v3.0
==========================================
КОМБИНИРОВАННАЯ ЛОГИКА:
1. Используем Hi-Fi фичи из debug-rhythm (spectral features, HPSS)
2. Улучшенный поиск якоря с множественными проверками
3. Строгая Grid Lock валидация (счёт 1 и 5 всегда на % 4 == 0)
4. Интеллектуальный backtrack с проверкой silence и musical events
5. Валидация найденного offset через соседние биты
"""

import sys
import os
import json
import warnings
import collections
import collections.abc
import numpy as np
import tempfile

# --- CRITICAL PATCHES ---
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

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
    from madmom.features.tempo import TempoEstimationProcessor
except ImportError as e:
    print(f"Error: madmom is required: {e}", file=sys.stderr)
    sys.exit(1)


# ==========================================
# HELPER FUNCTIONS (Hi-Fi Features)
# ==========================================

def get_rms(chunk):
    """RMS энергии для чанка"""
    if len(chunk) == 0: 
        return 0.0
    return float(np.sqrt(np.mean(chunk**2)))


def get_band_energy(y, sr, time_sec, freq_range, window_sec=0.08):
    """
    Энергия в определённой частотной полосе в момент времени.
    freq_range: (low_hz, high_hz), None для открытых границ
    """
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    
    if start >= end: 
        return 0.0
        
    chunk = y[start:end]
    if len(chunk) < 50: 
        return get_rms(chunk)
    
    # Применяем фильтр
    sos = None
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
    Спектральные фичи: flatness, rolloff, zero crossing rate
    Помогают отличить тишину, шум и музыкальные события
    """
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    
    if start >= end: 
        return 0.0, 0.0, 0.0
    
    chunk = y[start:end]
    n_fft = min(1024, len(chunk))
    if n_fft == 0: 
        return 0.0, 0.0, 0.0
    
    flat = float(np.mean(librosa.feature.spectral_flatness(y=chunk, n_fft=n_fft)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=chunk, sr=sr, n_fft=n_fft, roll_percent=0.85)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(chunk)))
    
    return flat, rolloff, zcr


def is_silence(beat_data, threshold_total=0.05, threshold_zcr=0.1):
    """
    Проверка на цифровую тишину или очень слабый сигнал
    """
    return (
        beat_data.get('norm_total', 1.0) < threshold_total and 
        beat_data.get('norm_zcr', 1.0) < threshold_zcr
    )


def is_musical_event(beat_data, min_bass=0.15, min_total=0.1, min_madmom=0.2):
    """
    Проверка на наличие музыкального события (не просто шум)
    """
    return (
        beat_data.get('norm_low', 0) > min_bass or
        beat_data.get('norm_total', 0) > min_total or
        beat_data.get('madmom_score', 0) > min_madmom
    )


# ==========================================
# MAIN BEAT ANALYSIS & FEATURE EXTRACTION
# ==========================================

def extract_beat_features(y, y_harm, y_perc, sr, beat_times, activations):
    """
    Извлекаем полный набор фичей для каждого бита
    """
    beats_data = []
    prev_stats = {"low": 0.0, "mid": 0.0, "high": 0.0, "total": 0.0}
    
    for i, t in enumerate(beat_times):
        # Энергетические фичи
        e_low = get_band_energy(y, sr, t, (None, 200))
        e_mid = get_band_energy(y, sr, t, (200, 2000))
        e_high = get_band_energy(y, sr, t, (4000, None))
        e_total = get_band_energy(y, sr, t, (None, None))
        
        # Спектральные фичи
        flat, rolloff, zcr = get_spectral_features(y, sr, t)
        
        # HPSS компоненты
        e_harm = get_band_energy(y_harm, sr, t, (None, None), window_sec=0.08)
        e_perc = get_band_energy(y_perc, sr, t, (None, None), window_sec=0.08)
        
        # Madmom downbeat probability
        frame_idx = min(int(t * 100), len(activations)-1)
        prob_downbeat = float(activations[frame_idx, 1])
        
        # Временные характеристики
        delta_time = 0.0
        local_bpm = 0.0
        if i > 0:
            delta_time = t - beat_times[i-1]
            if delta_time > 0: 
                local_bpm = 60.0 / delta_time

        # Изменения относительно предыдущего бита
        def pct_change(curr, prev): 
            if prev < 1e-6: 
                return 0.0
            return ((curr - prev) / prev) * 100
        
        diffs = {
            "low": pct_change(e_low, prev_stats['low']),
            "mid": pct_change(e_mid, prev_stats['mid']),
            "high": pct_change(e_high, prev_stats['high']),
            "total": pct_change(e_total, prev_stats['total'])
        }
        prev_stats = {"low": e_low, "mid": e_mid, "high": e_high, "total": e_total}

        beats_data.append({
            "id": i,
            "time": t,
            "low": e_low,
            "mid": e_mid,
            "high": e_high,
            "total": e_total,
            "harm": e_harm,
            "perc": e_perc,
            "flat": flat,
            "rolloff": rolloff,
            "zcr": zcr,
            "madmom_score": prob_downbeat,
            "delta": delta_time,
            "bpm": local_bpm,
            "diffs": diffs
        })

    # Нормализация (используем первые 100 битов как референс)
    limit_idx = min(len(beats_data), 100)
    max_vals = {}
    keys_to_norm = ['low', 'mid', 'high', 'total', 'harm', 'perc', 'rolloff', 'zcr']
    
    for k in keys_to_norm:
        vals = [b[k] for b in beats_data[:limit_idx]]
        m = max(vals) if vals else 1.0
        max_vals[k] = m if m > 0 else 1.0

    for b in beats_data:
        for k in max_vals:
            b[f"norm_{k}"] = round(b[k] / max_vals[k], 3)

    return beats_data


# ==========================================
# IMPROVED OFFSET DETECTION LOGIC
# ==========================================

def find_anchor_beat(beats_data):
    """
    Шаг 1: Находим надёжный якорь (anchor) для начала анализа
    
    Стратегия:
    1. Ищем первый бит с сильным басом + высокой уверенностью Madmom (Bass Anchor)
    2. Если не нашли, ищем просто сильный бит в начале (Rhythm Anchor)
    3. В крайнем случае берём первый бит
    """
    anchor = None
    reason = ""
    
    # Поиск Bass Anchor (идеальный случай)
    for i in range(min(len(beats_data), 32)):  # Смотрим первые ~8 тактов
        b = beats_data[i]
        
        # Bass Anchor: сильный бас + высокая вероятность от Madmom
        if b['norm_low'] > 0.4 and b['madmom_score'] > 0.35:
            anchor = b
            reason = "Bass Anchor"
            print(f"[Anchor] Found Bass Anchor at beat {i} (time: {b['time']:.2f}s)", file=sys.stderr)
            break
    
    # Fallback: Rhythm Anchor
    if not anchor:
        for i in range(min(len(beats_data), 16)):
            b = beats_data[i]
            if b['madmom_score'] > 0.4 and b['norm_total'] > 0.25:
                anchor = b
                reason = "Rhythm Anchor"
                print(f"[Anchor] Found Rhythm Anchor at beat {i} (time: {b['time']:.2f}s)", file=sys.stderr)
                break
    
    # Last resort
    if not anchor and beats_data:
        anchor = beats_data[0]
        reason = "First Beat (Fallback)"
        print(f"[Anchor] Using first beat as fallback", file=sys.stderr)
    
    return anchor, reason


def validate_and_update_anchor(beats_data, anchor):
    """
    Шаг 2: Проверяем, не нашли ли мы intro вместо настоящего drop
    
    Если через 4 или 8 битов энергия значительно возрастает,
    возможно это настоящая 1 (crescendo pattern)
    """
    if not anchor:
        return anchor, ""
    
    idx = anchor['id']
    reason_update = ""
    
    # Проверяем +4 бита (половина такта)
    if idx + 4 < len(beats_data):
        next_4 = beats_data[idx + 4]
        bass_ratio = next_4['norm_low'] / (anchor['norm_low'] + 0.01)
        
        if bass_ratio > 1.8 and next_4['madmom_score'] > 0.35:
            print(f"[Anchor] Crescendo detected at +4 beats (ratio: {bass_ratio:.2f})", file=sys.stderr)
            anchor = next_4
            reason_update = " -> Crescendo +4"
    
    # Проверяем +8 битов (полный такт)
    if idx + 8 < len(beats_data):
        next_8 = beats_data[idx + 8]
        bass_ratio = next_8['norm_low'] / (anchor['norm_low'] + 0.01)
        
        if bass_ratio > 2.0 and next_8['madmom_score'] > 0.4:
            print(f"[Anchor] Strong crescendo at +8 beats (ratio: {bass_ratio:.2f})", file=sys.stderr)
            anchor = next_8
            reason_update = " -> Crescendo +8"
    
    return anchor, reason_update


def backtrack_to_start(beats_data, anchor):
    """
    Шаг 3: "Tank Strategy" - идём назад шагами по 8 битов
    
    Но с проверками:
    - Не попадаем ли в тишину
    - Сохраняется ли музыкальная активность
    - Grid Lock: якорь должен быть на счёте 1 или 5 (% 4 == 0)
    """
    if not anchor:
        return anchor, ""
    
    current = anchor
    steps_back = 0
    reason_backtrack = ""
    
    # Идём назад шагами по 8 битов (1 фраза в бачате)
    while current['id'] - 8 >= 0:
        candidate_idx = current['id'] - 8
        candidate = beats_data[candidate_idx]
        
        # Проверка 1: Это не тишина?
        if is_silence(candidate):
            print(f"[Backtrack] Silence detected at beat {candidate_idx}, stopping", file=sys.stderr)
            break
        
        # Проверка 2: Есть ли музыкальная активность?
        if not is_musical_event(candidate, min_bass=0.08, min_total=0.05):
            print(f"[Backtrack] Weak signal at beat {candidate_idx}, stopping", file=sys.stderr)
            break
        
        # Проверка 3: Grid Lock - проверяем что мы на правильной фазе
        # Расстояние от якоря до кандидата должно быть кратно 8 (полный квадрат бачаты)
        distance = anchor['id'] - candidate_idx
        if distance % 8 != 0:
            print(f"[Backtrack] Grid lock violation at beat {candidate_idx} (dist={distance})", file=sys.stderr)
            break
        
        # Всё ок, двигаемся дальше назад
        current = candidate
        steps_back += 1
        reason_backtrack = f" -> Back x{steps_back}"
        print(f"[Backtrack] Step {steps_back}: moved to beat {candidate_idx} (time: {candidate['time']:.2f}s)", file=sys.stderr)
    
    return current, reason_backtrack


def validate_offset_locally(beats_data, start_beat):
    """
    Шаг 4: Локальная валидация найденного offset
    
    Проверяем, что соседние биты подтверждают нашу находку:
    - Следующие 3-4 бита должны показывать развитие энергии
    - Не должно быть более сильного события в ближайших битах
    """
    if not start_beat:
        return start_beat, ""
    
    idx = start_beat['id']
    reason_validation = ""
    
    # Проверяем следующие 4 бита
    if idx + 4 < len(beats_data):
        # Считаем среднюю энергию следующей четвёрки
        next_4_beats = beats_data[idx+1:idx+5]
        avg_next_energy = np.mean([b['norm_total'] for b in next_4_beats])
        
        # Если следующие биты значительно слабее, возможно мы нашли концовку предыдущей фразы
        if avg_next_energy < start_beat['norm_total'] * 0.3:
            # Пробуем сдвинуться на +4 (следующая 1)
            candidate = beats_data[idx + 4]
            if is_musical_event(candidate):
                print(f"[Validation] Energy drop detected, shifting +4 beats", file=sys.stderr)
                start_beat = candidate
                reason_validation = " -> Validation +4"
    
    # Проверяем предыдущие 2 бита на наличие более сильного события
    if idx >= 2:
        prev_2_beats = beats_data[idx-2:idx]
        max_prev_bass = max([b['norm_low'] for b in prev_2_beats])
        
        # Если предыдущие биты значительно сильнее, возможно мы пропустили настоящую 1
        if max_prev_bass > start_beat['norm_low'] * 1.5:
            # Но только если это соблюдает Grid Lock
            for pb in prev_2_beats:
                if (idx - pb['id']) % 8 == 0 and is_musical_event(pb):
                    print(f"[Validation] Stronger event found at beat {pb['id']}, adjusting", file=sys.stderr)
                    start_beat = pb
                    reason_validation = " -> Validation (stronger prev)"
                    break
    
    return start_beat, reason_validation


def find_optimal_offset(beats_data):
    """
    ГЛАВНАЯ ФУНКЦИЯ: Находит оптимальный offset (счёт 1)
    
    Комбинирует все стратегии:
    1. Находим якорь
    2. Проверяем на crescendo
    3. Делаем backtrack до начала
    4. Валидируем результат локально
    """
    if not beats_data:
        return None, "No beats detected"
    
    # Шаг 1: Поиск якоря
    anchor, reason = find_anchor_beat(beats_data)
    
    # Шаг 2: Обновление якоря (crescendo check)
    anchor, reason_crescendo = validate_and_update_anchor(beats_data, anchor)
    reason += reason_crescendo
    
    # Шаг 3: Backtrack до начала
    start_beat, reason_back = backtrack_to_start(beats_data, anchor)
    reason += reason_back
    
    # Шаг 4: Локальная валидация
    start_beat, reason_val = validate_offset_locally(beats_data, start_beat)
    reason += reason_val
    
    # Финальная проверка на silence
    if start_beat and is_silence(start_beat):
        print(f"[Final Check] Start beat is silence, shifting +8", file=sys.stderr)
        new_idx = start_beat['id'] + 8
        if new_idx < len(beats_data):
            candidate = beats_data[new_idx]
            if is_musical_event(candidate):
                start_beat = candidate
                reason += " -> Skip Silence"
    
    if start_beat:
        print(f"\n[VERDICT] Start Beat: {start_beat['id']} (time: {start_beat['time']:.3f}s)", file=sys.stderr)
        print(f"[REASON] {reason}\n", file=sys.stderr)
    
    return start_beat, reason


# ==========================================
# MAIN ANALYSIS FUNCTION
# ==========================================

def analyze_track_with_madmom(audio_path, drums_path=None):
    """
    Главная функция анализа трека
    """
    try:
        # 1. Загрузка аудио
        analysis_audio_path = drums_path if drums_path and os.path.exists(drums_path) else audio_path
        print(f"[Loading] Using {'DRUMS' if analysis_audio_path == drums_path else 'ORIGINAL'} track", file=sys.stderr)
        
        y_analysis, sr = librosa.load(analysis_audio_path, sr=None, mono=True)
        if analysis_audio_path != audio_path:
            y_orig, sr_orig = librosa.load(audio_path, sr=None, mono=True)
        else:
            y_orig, sr_orig = y_analysis, sr
            
        duration = len(y_orig) / sr_orig
        print(f"[Loading] Duration: {duration:.2f}s, SR: {sr}Hz", file=sys.stderr)
        
        # 2. HPSS разделение
        print(f"[Processing] Applying HPSS decomposition...", file=sys.stderr)
        y_harm, y_perc = librosa.effects.hpss(y_analysis, margin=1.0)
        
        # 3. Madmom анализ
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        sf.write(tmp_path, y_analysis, sr)
        
        try:
            print(f"[Madmom] Running RNN DownBeat Processor...", file=sys.stderr)
            proc = RNNDownBeatProcessor()
            activations = proc(tmp_path)
            
            print(f"[Madmom] Tracking beats...", file=sys.stderr)
            beat_processor = DBNBeatTrackingProcessor(fps=100)
            beat_times = beat_processor(activations[:, 0])
            all_beats = [float(b) for b in beat_times]
            
            print(f"[Madmom] Found {len(all_beats)} beats", file=sys.stderr)
            
        finally:
            try: 
                os.unlink(tmp_path)
            except: 
                pass

        if not all_beats:
            raise Exception("No beats detected")

        # 4. Извлечение фичей для каждого бита
        print(f"[Features] Extracting beat features...", file=sys.stderr)
        beats_data = extract_beat_features(y_orig, y_harm, y_perc, sr_orig, all_beats, activations)
        
        # 5. BPM расчёт (Strict Mean)
        print(f"[BPM] Calculating tempo...", file=sys.stderr)
        if len(all_beats) > 1:
            intervals = np.diff(all_beats)
            avg_interval = np.mean(intervals)
            bpm_mean = 60.0 / avg_interval
        else:
            bpm_mean = 120.0

        # Проверка на удвоение/половинение
        try:
            tempo_proc = TempoEstimationProcessor(fps=100, min_bpm=60, max_bpm=190)
            tempos = tempo_proc(activations)
            
            if len(tempos) > 0:
                bpm_global = tempos[0][0]
                ratio = bpm_global / bpm_mean
                
                if 1.8 < ratio < 2.2:
                    print(f"[BPM] Doubling: {bpm_mean:.1f} -> {bpm_mean*2:.1f}", file=sys.stderr)
                    bpm_mean *= 2
                elif 0.4 < ratio < 0.6:
                    print(f"[BPM] Halving: {bpm_mean:.1f} -> {bpm_mean/2:.1f}", file=sys.stderr)
                    bpm_mean /= 2
        except Exception as e:
            print(f"[BPM] Warning: Tempo validation failed ({e})", file=sys.stderr)

        bpm = int(round(bpm_mean))
        print(f"[BPM] Final BPM: {bpm}", file=sys.stderr)

        # 6. НАХОДИМ OFFSET (главная магия!)
        print(f"\n[Offset Detection] Starting analysis...", file=sys.stderr)
        start_beat, reason = find_optimal_offset(beats_data)
        
        if not start_beat:
            raise Exception("Could not determine offset")
        
        offset = start_beat['time']
        
        # 7. Генерация сетки
        print(f"[Grid] Generating grid from offset {offset:.3f}s", file=sys.stderr)
        beat_interval = 60.0 / bpm
        section_duration = 8 * beat_interval  # 1 фраза = 8 битов
        
        grid = []
        current_time = offset
        
        # Генерируем сетку до конца трека
        while current_time < duration:
            end_time = current_time + section_duration
            if current_time >= 0:
                grid.append({
                    "type": "verse",
                    "start": round(current_time, 3),
                    "beats": 8
                })
            current_time += section_duration

        # Даунбиты (счёт 1 и 5)
        downbeats = []
        db_time = offset
        while db_time < duration:
            if db_time >= 0:
                downbeats.append(round(db_time, 3))
            db_time += beat_interval * 4

        # 8. Формируем результат
        result = {
            'bpm': bpm,
            'offset': round(offset, 3),
            'duration': duration,
            'grid': grid,
            'downbeats': downbeats,
            'totalBeats': len(all_beats),
            'analysis': {
                'version': 'v3.0-hybrid',
                'start_beat_id': start_beat['id'],
                'detection_reason': reason,
                'confidence_scores': {
                    'bass': round(start_beat['norm_low'], 3),
                    'madmom': round(start_beat['madmom_score'], 3),
                    'total_energy': round(start_beat['norm_total'], 3)
                }
            }
        }
        
        return result

    except Exception as e:
        print(f"[Error] {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return {
            'bpm': 120, 
            'offset': 0.0, 
            'duration': 180, 
            'grid': [], 
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
