#!/usr/bin/env python3
"""
Умный анализ ритма с использованием Madmom и детекцией мостиков
Заменяет старый analyze-bpm-offset.py
"""

# ВАЖНО: Патчи должны применяться ДО ВСЕХ импортов, включая numpy и scipy!
import sys
import os
import collections
import collections.abc

# Патч 1: Python 3.10+ - добавляем обратную совместимость для collections
# Должен быть применен ДО импорта madmom, так как madmom использует эти классы
if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence
    if not hasattr(collections, 'MutableMapping'):
        collections.MutableMapping = collections.abc.MutableMapping
    if not hasattr(collections, 'Mapping'):
        collections.Mapping = collections.abc.Mapping
    if not hasattr(collections, 'Sequence'):
        collections.Sequence = collections.abc.Sequence
    if not hasattr(collections, 'Iterable'):
        collections.Iterable = collections.abc.Iterable
    if not hasattr(collections, 'Iterator'):
        collections.Iterator = collections.abc.Iterator
    if not hasattr(collections, 'Callable'):
        collections.Callable = collections.abc.Callable

# Патч 2: NumPy 1.20+ - добавляем обратную совместимость для np.float, np.int, np.bool
# Должен быть применен ДО импорта madmom, так как madmom использует эти типы при импорте
import numpy as np
import warnings

# Подавляем предупреждение о np.bool и применяем патч
with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'):
        np.float = np.float64
    if not hasattr(np, 'int'):
        np.int = np.int64
    if not hasattr(np, 'bool'):
        np.bool = np.bool_
    if not hasattr(np, 'complex'):
        np.complex = np.complex128

# Теперь можно импортировать остальные модули
import json
from scipy import signal

import librosa  # Используется только для загрузки аудио

# Импорт madmom (обязателен)
try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
    from madmom.features.downbeats import DBNDownBeatTrackingProcessor
    from madmom.audio.signal import SignalProcessor, FramedSignalProcessor
    from madmom.audio.stft import ShortTimeFourierTransformProcessor
    from madmom.audio.spectrogram import LogarithmicSpectrogramProcessor
    from madmom.features.onsets import OnsetPeakPickingProcessor
except ImportError as e:
    print(f"Error: madmom is required but not available: {e}", file=sys.stderr)
    sys.exit(1)


def calculate_global_offset(downbeats, bpm):
    if not downbeats:
        return 0.0
    beat_interval = 60.0 / bpm
    bar_interval = beat_interval * 4
    reference_point = downbeats[0]
    deviations = []
    for db in downbeats:
        n_bars = round((db - reference_point) / bar_interval)
        ideal_time = reference_point + (n_bars * bar_interval)
        deviations.append(db - ideal_time)
    median_deviation = np.median(deviations)
    global_offset = reference_point + median_deviation
    while global_offset < 0: global_offset += bar_interval
    while global_offset >= bar_interval: global_offset -= bar_interval
    return global_offset


def find_smart_drop_index(bass_values):
    """
    Находит индекс бита, где начинается истинный "Счет 1" (Bass Drop).
    
    Алгоритм:
    1. Находит "Явный Пик" (Anchor Candidate) - первый бит где rel_bass > 0.5
       и держится высокой еще 1-2 бита (проверка на сустейн).
    2. Проверяет "Атаку" (Pre-beat check) - если бит index-1 имеет энергию > 0.15
       и в 2 раза громче index-2, сдвигает Anchor на index-1.
    
    Args:
        bass_values: массив относительной энергии баса для каждого бита (нормализованный)
    
    Returns:
        int: индекс бита, где начинается истинный "Счет 1"
    """
    if len(bass_values) < 3:
        return 0
    
    # Шаг 1: Находим "Явный Пик" (Anchor Candidate)
    anchor_idx = None
    
    for i in range(len(bass_values) - 2):
        # Проверяем, что текущий бит превышает порог 0.5
        if bass_values[i] > 0.5:
            # Проверяем сустейн: следующий 1-2 бита тоже должны быть высокими
            sustain_ok = True
            if i + 1 < len(bass_values):
                if bass_values[i + 1] < 0.3:  # Слишком резкий спад
                    sustain_ok = False
            if i + 2 < len(bass_values):
                if bass_values[i + 2] < 0.25:  # Еще больше спадает
                    sustain_ok = False
            
            if sustain_ok:
                anchor_idx = i
                break
    
    # Если не нашли явный пик, берем первый бит с энергией > 0.4
    if anchor_idx is None:
        for i in range(len(bass_values)):
            if bass_values[i] > 0.4:
                anchor_idx = i
                break
    
    # Если все еще не нашли, берем первый бит
    if anchor_idx is None:
        anchor_idx = 0
    
    print(f"[SmartBassDrop] Anchor Candidate found at beat index {anchor_idx} (bass={bass_values[anchor_idx]:.4f})", file=sys.stderr)
    
    # Шаг 2: Проверяем "Атаку" (Pre-beat check)
    if anchor_idx > 0:
        prev_bass = bass_values[anchor_idx - 1]
        
        # Проверяем условия для сдвига на предыдущий бит
        has_significant_energy = prev_bass > 0.15
        
        # Проверяем резкий скачок (в 2 раза громче относительно index-2)
        is_sharp_jump = False
        if anchor_idx > 1:
            prev_prev_bass = bass_values[anchor_idx - 2]
            if prev_prev_bass > 0:
                ratio = prev_bass / prev_prev_bass
                is_sharp_jump = ratio >= 2.0
        else:
            # Если нет index-2, считаем скачок если prev_bass > 0.2
            is_sharp_jump = prev_bass > 0.2
        
        if has_significant_energy and is_sharp_jump:
            print(f"[SmartBassDrop] Pre-beat attack detected! Shifting from beat {anchor_idx} to {anchor_idx - 1}", file=sys.stderr)
            print(f"[SmartBassDrop]   Beat {anchor_idx - 1}: bass={prev_bass:.4f}", file=sys.stderr)
            anchor_idx = anchor_idx - 1
    
    print(f"[SmartBassDrop] Final drop index: {anchor_idx} (bass={bass_values[anchor_idx]:.4f})", file=sys.stderr)
    
    return anchor_idx


def analyze_track_with_madmom(audio_path, drums_path=None):
    """
    Анализирует трек с использованием madmom
    
    Args:
        audio_path: путь к основному аудио файлу
        drums_path: опциональный путь к дорожке drums (для более точного анализа ритма)
    
    Returns:
        dict с ключами 'bpm', 'offset', 'grid'
    """
    try:
        # ВАЖНО: BPM всегда вычисляется на оригинальном треке (полный микс)
        # drums_path может использоваться для других целей, но не для BPM/beat tracking
        if drums_path and os.path.exists(drums_path):
            print(f"[Analysis] DRUMS track provided (will be used for other purposes), but BPM analysis uses original audio", file=sys.stderr)
        
        # Загружаем оригинальное аудио для определения длительности
        y_original, sr_orig = librosa.load(audio_path, sr=None, mono=True)
        duration = len(y_original) / sr_orig
        
        print(f"Analyzing track: {audio_path}", file=sys.stderr)
        print(f"Duration: {duration:.2f}s, Sample rate: {sr_orig}Hz", file=sys.stderr)
        
        # 1. Запуск Madmom RNNDownBeatProcessor
        # ВСЕГДА используем оригинальный трек для BPM анализа
        print("Step 1: Running RNNDownBeatProcessor on original audio (full mix)...", file=sys.stderr)
        proc = RNNDownBeatProcessor()
        act = proc(audio_path)
        
        # 2. Beat Tracking
        print("Step 2: Tracking beats...", file=sys.stderr)
        # fps=200 дает разрешение 5мс, что решает проблему точности для 125/126 BPM
        beat_processor = DBNBeatTrackingProcessor(fps=200)
        beat_times = beat_processor(act[:, 0])
        
        # 3. Downbeat Decoding (Определение "Раз")
        from scipy.signal import find_peaks
        fps = 200  # FPS=200 для точности (разрешение 5мс вместо 10мс)
        downbeat_act = act[:, 1]
        
        # Находим пики вероятности downbeat
        threshold = np.percentile(downbeat_act, 60) 
        min_dist = int(fps * 0.45 * 4) # ~полтакта минимум
        peaks, _ = find_peaks(downbeat_act, height=threshold, distance=min_dist)
        
        raw_downbeats = peaks / fps
        
        # Сопоставляем beats и downbeats
        beats_with_labels = []
        downbeats = []
        all_beats = [float(b) for b in beat_times]
        
        for b in all_beats:
            # Ближайший пик downbeat
            closest_db_dist = min([abs(b - db) for db in raw_downbeats]) if len(raw_downbeats) > 0 else 999
            
            if closest_db_dist < 0.1: # Если удар совпадает с пиком downbeat канала
                label = 1
                downbeats.append(b)
            else:
                label = 0
            beats_with_labels.append({'time': b, 'label': label})
        
        # 4. Расчет BPM
        if len(all_beats) > 1:
            intervals = np.diff(all_beats)
            bpm = round(60.0 / np.median(intervals))
        else:
            bpm = 120

        print(f"[Analysis] Calculated BPM: {bpm}", file=sys.stderr)
        
        # 5. Smart Bass Drop - поиск истинного начала музыкального квадрата
        print("\n" + "=" * 80, file=sys.stderr)
        print("Step 5: Smart Bass Drop - Finding true musical square start...", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        
        # 5a. Применяем Low-Pass фильтр для выделения баса
        print("[SmartBassDrop] Applying Low-Pass filter (<200Hz) to extract bass...", file=sys.stderr)
        try:
            # Частота среза 200Hz (бас и бочка), порядок 6 для резкого спада
            sos = signal.butter(6, 200, 'low', fs=sr_orig, output='sos')
            y_bass = signal.sosfilt(sos, y_original)
            print(f"[SmartBassDrop] Filter applied successfully", file=sys.stderr)
        except Exception as e:
            print(f"[SmartBassDrop] Warning: Filter failed ({e}), using raw audio", file=sys.stderr)
            y_bass = y_original
        
        # 5b. Вычисляем относительную энергию баса для каждого бита
        print("[SmartBassDrop] Computing bass energy for each beat...", file=sys.stderr)
        beat_interval = 60.0 / bpm
        bass_values = []
        
        for beat_time in all_beats:
            # Вычисляем энергию баса в окне вокруг бита (±половина интервала бита)
            window_start = max(0, int((beat_time - beat_interval * 0.5) * sr_orig))
            window_end = min(len(y_bass), int((beat_time + beat_interval * 0.5) * sr_orig))
            
            if window_end > window_start:
                # RMS энергия в окне
                window_data = y_bass[window_start:window_end]
                energy = np.sqrt(np.mean(window_data ** 2))
            else:
                energy = 0.0
            
            bass_values.append(energy)
        
        # Нормализуем значения (делим на максимум)
        if len(bass_values) > 0:
            max_bass = max(bass_values)
            if max_bass > 0:
                bass_values = [v / max_bass for v in bass_values]
            else:
                bass_values = [0.0] * len(bass_values)
        
        print(f"[SmartBassDrop] Computed {len(bass_values)} bass energy values (normalized)", file=sys.stderr)
        
        # 5c. Находим индекс бита с истинным "Счетом 1"
        drop_index = find_smart_drop_index(bass_values)
        
        # 5d. Вычисляем offset на основе найденного индекса
        if drop_index < len(all_beats):
            offset = all_beats[drop_index]
        elif len(all_beats) > 0:
            offset = all_beats[0]
        else:
            offset = 0.0
        
        offset = round(offset, 3)
        print(f"[SmartBassDrop] Final offset: {offset:.3f}s (beat index {drop_index})", file=sys.stderr)

        # 6. Формирование сетки с back-calculation
        print("\n" + "=" * 80, file=sys.stderr)
        print("Step 6: Creating grid with back-calculation...", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        
        beat_interval = 60.0 / bpm
        section_duration_beats = 8  # Ровно 8 счетов (2 такта)
        section_duration_time = section_duration_beats * beat_interval
        
        # Back-calculation: находим первый "Счет 1" до drop_index
        # Если drop_index = 19, то бит 11 - это 1, бит 3 - это 1
        # Шагаем назад по 8 битов от drop_index, пока не дойдем до начала трека
        current_beat_idx = drop_index
        
        # Находим первый "Счет 1" (шагаем назад по 8 битов)
        while current_beat_idx >= section_duration_beats:
            current_beat_idx -= section_duration_beats
        
        # Теперь current_beat_idx указывает на первый "Счет 1" в треке
        if 0 <= current_beat_idx < len(all_beats):
            first_section_start = all_beats[current_beat_idx]
        else:
            # Если индекс выходит за границы, вычисляем время из offset
            beats_back = drop_index - current_beat_idx
            first_section_start = offset - beats_back * beat_interval
            if first_section_start < 0:
                first_section_start = 0.0
        
        print(f"[Grid] Drop index: {drop_index}, First section start: {first_section_start:.3f}s (beat index: {current_beat_idx})", file=sys.stderr)
        
        # Генерируем сетку, начиная с первого "Счета 1"
        grid = []
        current_time = first_section_start
        
        while current_time < duration:
            grid.append({
                "type": "verse",
                "start": round(current_time, 3),
                "beats": section_duration_beats
            })
            current_time += section_duration_time
        
        print(f"  ✓ Created {len(grid)} verse sections (8 beats each)", file=sys.stderr)
        
        if grid:
            print(f"\nGrid sections breakdown:", file=sys.stderr)
            for i, section in enumerate(grid[:10]):  # Показываем первые 10
                section_end = section['start'] + (section['beats'] * beat_interval)
                print(f"  [{i+1:2d}] {section['type'].upper():6s} | "
                      f"Start: {section['start']:7.3f}s | "
                      f"Beats: {section['beats']:3d} | "
                      f"End: {section_end:7.3f}s", file=sys.stderr)
            if len(grid) > 10:
                print(f"  ... and {len(grid) - 10} more sections", file=sys.stderr)
        
        return {
            'bpm': bpm,
            'offset': offset,
            'duration': duration,
            'grid': grid,
            'downbeats': downbeats,
            'totalBeats': len(all_beats)
        }
        
    except Exception as e:
        print(f"Error in madmom analysis: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        raise






def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Audio path required'}), file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    drums_path = None
    
    # Проверяем аргументы для drums
    if len(sys.argv) >= 4 and sys.argv[2] == '--use-drums':
        drums_path = sys.argv[3]
        if not os.path.exists(drums_path):
            print(f"Warning: Drums path does not exist: {drums_path}, using original audio", file=sys.stderr)
            drums_path = None
    
    try:
        result = analyze_track_with_madmom(audio_path, drums_path)
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'bpm': 120,
            'offset': 0.0,
            'duration': 180,
            'grid': [{
                'type': 'verse',
                'start': 0.0,
                'beats': 100
            }]
        }
        print(json.dumps(error_result), file=sys.stderr)
        print(json.dumps(error_result))  # Также выводим в stdout для парсинга
        sys.exit(1)


if __name__ == '__main__':
    main()

