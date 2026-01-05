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

# DEBUG MODE: Отключение фильтров для отладки
# Если True, скрипт НЕ будет объединять секции короче 4-х битов, а выдаст всё как есть
# ВАЖНО: Для продакшена установите False, чтобы фильтровать микро-секции
DEBUG_NO_FILTER = False

# Импорт Essentia (опционально, с fallback на librosa)
# ВАЖНО: Essentia не работает на Windows - используйте librosa fallback
ESSENTIA_AVAILABLE = False
try:
    import essentia
    import essentia.standard as es
    ESSENTIA_AVAILABLE = True
    print("[INFO] ✓ Essentia library loaded successfully - using for structure analysis", file=sys.stderr)
except ImportError:
    # Это нормально - librosa fallback работает на всех платформах
    print("[INFO] Essentia not available (this is OK on Windows). Using librosa fallback for structure analysis.", file=sys.stderr)
    ESSENTIA_AVAILABLE = False
except Exception as e:
    # Другие ошибки (например, проблемы с компиляцией на Windows)
    print(f"[INFO] Essentia not available ({type(e).__name__}). Using librosa fallback for structure analysis.", file=sys.stderr)
    ESSENTIA_AVAILABLE = False

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


def analyze_structure_essentia(audio_path):
    """
    Анализирует структуру трека с помощью Essentia
    Находит границы секций (boundaries) где меняется гармония
    
    Args:
        audio_path: путь к аудио файлу
    
    Returns:
        list: список временных меток границ секций в секундах
    """
    if not ESSENTIA_AVAILABLE:
        return []
    
    try:
        print("[Essentia] Loading audio file...", file=sys.stderr)
        loader = es.MonoLoader(filename=audio_path)
        audio = loader()
        sample_rate = 44100  # Essentia MonoLoader использует 44100 по умолчанию
        
        print(f"[Essentia] Audio loaded: {len(audio)} samples, {len(audio)/sample_rate:.2f}s", file=sys.stderr)
        
        # Вычисляем MFCC features для анализа структуры
        print("[Essentia] Computing MFCC features for structure analysis...", file=sys.stderr)
        mfcc = es.MFCC()
        windowing = es.Windowing(type='hann')
        spectrum = es.Spectrum()
        
        # Обрабатываем аудио по кадрам
        frame_size = 2048
        hop_size = 512
        frames = es.FrameGenerator(audio, frameSize=frame_size, hopSize=hop_size)
        
        mfccs = []
        for frame in frames:
            spec = spectrum(windowing(frame))
            mfcc_coeffs, mfcc_bands = mfcc(spec)
            mfccs.append(mfcc_coeffs)
        
        mfccs = np.array(mfccs)
        print(f"[Essentia] Computed {len(mfccs)} MFCC frames", file=sys.stderr)
        
        # Вычисляем матрицу само-подобия (self-similarity matrix)
        print("[Essentia] Computing self-similarity matrix...", file=sys.stderr)
        from scipy.spatial.distance import cdist
        similarity_matrix = 1 - cdist(mfccs, mfccs, metric='cosine')
        
        # Находим границы секций используя алгоритм поиска изменений в матрице подобия
        row_similarity = np.mean(similarity_matrix, axis=1)
        similarity_diff = np.diff(row_similarity)
        
        # Находим пики в производной (резкие изменения структуры)
        from scipy.signal import find_peaks
        peaks, properties = find_peaks(np.abs(similarity_diff), 
                                      height=np.percentile(np.abs(similarity_diff), 75),
                                      distance=int(sample_rate / hop_size * 2))  # Минимум 2 секунды между границами
        
        # Преобразуем пики во временные метки
        frame_times = np.arange(len(mfccs)) * (hop_size / sample_rate)
        boundaries = frame_times[peaks].tolist()
        
        print(f"[Essentia] Found {len(boundaries)} structural boundaries: {[f'{b:.2f}s' for b in boundaries[:10]]}", file=sys.stderr)
        
        return boundaries
        
    except Exception as e:
        print(f"[Essentia] Error during structure analysis: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return []


def analyze_structure_librosa(audio_path):
    """
    Fallback: Анализирует структуру трека с помощью librosa
    Использует recurrence matrix для поиска границ секций
    
    Args:
        audio_path: путь к аудио файлу
    
    Returns:
        list: список временных меток границ секций в секундах
    """
    try:
        print("[Librosa Fallback] Loading audio for structure analysis...", file=sys.stderr)
        y, sr = librosa.load(audio_path, sr=22050)  # Используем меньшую частоту для скорости
        
        print(f"[Librosa Fallback] Computing chroma features...", file=sys.stderr)
        # Используем chroma features для анализа гармонии
        chroma = librosa.feature.chroma_stft(y=y, sr=sr)
        
        print(f"[Librosa Fallback] Computing recurrence matrix...", file=sys.stderr)
        # Вычисляем матрицу рекуррентности (self-similarity)
        R = librosa.segment.cross_similarity(chroma, chroma)
        
        # Находим границы секций используя agglomerative clustering
        # Используем chroma напрямую (не R), так как agglomerative работает с feature matrix
        print(f"[Librosa Fallback] Finding segment boundaries using agglomerative clustering...", file=sys.stderr)
        # agglomerative принимает feature matrix и количество сегментов k
        # Используем среднее значение между разумными границами
        k_segments = 10  # Количество сегментов для поиска
        boundaries = librosa.segment.agglomerative(chroma, k=k_segments)
        
        # Преобразуем frame индексы во времена
        times = librosa.frames_to_time(boundaries, sr=sr)
        
        # Фильтруем границы: оставляем только те, что достаточно далеко друг от друга (минимум 4 секунды)
        filtered_boundaries = [times[0]]
        for t in times[1:]:
            if t - filtered_boundaries[-1] >= 4.0:  # Минимум 4 секунды между границами
                filtered_boundaries.append(t)
        
        print(f"[Librosa Fallback] Found {len(filtered_boundaries)} structural boundaries: {[f'{b:.2f}s' for b in filtered_boundaries[:10]]}", file=sys.stderr)
        
        return filtered_boundaries
        
    except Exception as e:
        print(f"[Librosa Fallback] Error during structure analysis: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return []


def analyze_structure(audio_path):
    """
    Анализирует структуру трека, используя Essentia (приоритет) или librosa (fallback)
    
    Args:
        audio_path: путь к аудио файлу
    
    Returns:
        list: список временных меток границ секций в секундах
    """
    print(f"[analyze_structure] Starting structure analysis for: {audio_path}", file=sys.stderr)
    print(f"[analyze_structure] ESSENTIA_AVAILABLE = {ESSENTIA_AVAILABLE}", file=sys.stderr)
    
    if ESSENTIA_AVAILABLE:
        print("[analyze_structure] Attempting to use Essentia...", file=sys.stderr)
        try:
            boundaries = analyze_structure_essentia(audio_path)
            if boundaries and len(boundaries) > 0:
                print(f"[analyze_structure] Essentia returned {len(boundaries)} boundaries", file=sys.stderr)
                return boundaries
            else:
                print("[WARNING] Essentia returned no boundaries, falling back to librosa", file=sys.stderr)
        except Exception as e:
            print(f"[WARNING] Essentia failed with error: {e}, falling back to librosa", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
    
    # Fallback на librosa
    print("[analyze_structure] Using librosa fallback...", file=sys.stderr)
    try:
        boundaries = analyze_structure_librosa(audio_path)
        print(f"[analyze_structure] Librosa returned {len(boundaries)} boundaries", file=sys.stderr)
        return boundaries
    except Exception as e:
        print(f"[ERROR] Librosa fallback also failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return []


def merge_structure_with_beats(structure_boundaries, beats, downbeats, tolerance=0.5):
    """
    Объединяет границы структуры от Essentia/Librosa с битами от Madmom
    Для каждой границы находит ближайший бит и помечает его как начало секции
    
    Args:
        structure_boundaries: список временных меток границ от Essentia/Librosa
        beats: список всех битов от Madmom
        downbeats: список downbeats от Madmom
        tolerance: максимальное расстояние для сопоставления (в секундах)
    
    Returns:
        set: множество временных меток битов, которые должны быть началами секций
    """
    section_starts = set()
    
    if not structure_boundaries:
        print("[Merge] No structure boundaries found, using only Madmom analysis", file=sys.stderr)
        return section_starts
    
    print(f"[Merge] Merging {len(structure_boundaries)} structure boundaries with {len(beats)} beats", file=sys.stderr)
    
    # Объединяем beats и downbeats для поиска ближайших
    all_beat_times = sorted(set(beats + downbeats))
    
    for boundary_time in structure_boundaries:
        # Находим ближайший бит к границе
        closest_beat = None
        min_distance = float('inf')
        
        for beat_time in all_beat_times:
            distance = abs(beat_time - boundary_time)
            if distance < min_distance:
                min_distance = distance
                closest_beat = beat_time
        
        # Если ближайший бит находится в пределах tolerance, добавляем его
        if closest_beat is not None and min_distance <= tolerance:
            section_starts.add(closest_beat)
            print(f"[Merge] Structure boundary at {boundary_time:.2f}s -> beat at {closest_beat:.2f}s (distance: {min_distance:.3f}s)", file=sys.stderr)
        else:
            print(f"[Merge] Structure boundary at {boundary_time:.2f}s -> no close beat found (min distance: {min_distance:.3f}s > {tolerance}s)", file=sys.stderr)
    
    print(f"[Merge] Total section starts after merging: {len(section_starts)}", file=sys.stderr)
    return section_starts


def calculate_rms(audio_data, sample_rate, start_time, end_time):
    """
    Вычисляет RMS (Root Mean Square) энергию на указанном участке
    
    Args:
        audio_data: numpy array с аудио данными
        sample_rate: частота дискретизации
        start_time: начало участка в секундах
        end_time: конец участка в секундах
    
    Returns:
        RMS значение (float)
    """
    start_sample = int(start_time * sample_rate)
    end_sample = int(end_time * sample_rate)
    
    if start_sample < 0:
        start_sample = 0
    if end_sample > len(audio_data):
        end_sample = len(audio_data)
    
    if start_sample >= end_sample:
        return 0.0
    
    segment = audio_data[start_sample:end_sample]
    rms = np.sqrt(np.mean(segment ** 2))
    return float(rms)


def detect_bridges(downbeats, beats, audio_data, sample_rate, bpm, debug_data=None, structure_section_starts=None):
    """
    Детектирует мостики (bridges) в композиции по алгоритму "Mikhail's Logic"
    С применением "Танцевальной логики Бачаты": фильтрация микро-секций и кратность 4 битам
    Объединяет результаты Madmom (ритм) и Essentia/Librosa (структура)
    
    Args:
        downbeats: массив времен сильных долей (единиц)
        beats: массив всех ударов
        audio_data: numpy array с аудио данными
        sample_rate: частота дискретизации
        bpm: BPM трека
        debug_data: словарь для сохранения debug информации (опционально)
        structure_section_starts: множество временных меток границ структуры от Essentia/Librosa (опционально)
    
    Returns:
        list: список секций с типом (verse/bridge), отфильтрованных и выровненных
    """
    if len(downbeats) < 2:
        return []
    
    # Инициализируем список кандидатов для debug
    candidates_sections = []
    
    # Используем объединенные границы структуры для принудительного создания секций
    if structure_section_starts is None:
        structure_section_starts = set()
    
    # ВАЖНО: Если есть границы структуры от Librosa/Essentia - используем ТОЛЬКО их
    # Полностью отключаем RMS анализ, чтобы избежать ложных срабатываний
    use_structure_only = len(structure_section_starts) > 0
    
    if use_structure_only:
        print(f"[DEBUG] Structure-based mode: Using {len(structure_section_starts)} structure boundaries from Librosa/Essentia", file=sys.stderr)
        print(f"[DEBUG] RMS analysis DISABLED - trusting only structural boundaries", file=sys.stderr)
    else:
        print(f"[DEBUG] Fallback mode: No structure boundaries found, using RMS-based analysis", file=sys.stderr)
        # Вычисляем средний интервал между сильными долями (обычно 8 битов = 4 такта)
        intervals = np.diff(downbeats)
        avg_interval = np.mean(intervals)
        
        # Вычисляем среднюю RMS энергию по всему треку
        total_rms = calculate_rms(audio_data, sample_rate, 0, len(audio_data) / sample_rate)
        
        # Определяем порог для "короткого" интервала (обычно 4 бита вместо 8)
        # Если интервал меньше 60% от среднего, это потенциальный мостик
        short_interval_threshold = avg_interval * 0.6
        
        # Определяем порог для "громкого" участка (брейк)
        # Если RMS больше 1.5x от среднего, это брейк, а не мостик
        break_threshold = total_rms * 1.5
    
    # Вычисляем интервалы (нужны для обоих режимов)
    intervals = np.diff(downbeats)
    
    grid = []
    current_start = 0.0
    current_type = "verse"
    current_beats = 0
    
    # РЕЖИМ 1: Используем ТОЛЬКО границы структуры (Librosa/Essentia)
    if use_structure_only:
        print(f"[DEBUG] ===== STRUCTURE-ONLY MODE: Creating sections ONLY at structure boundaries =====", file=sys.stderr)
        
        # Проходим по всем сильным долям
        for i in range(len(downbeats) - 1):
            interval = intervals[i]
            downbeat_time = downbeats[i]
            next_downbeat_time = downbeats[i + 1]
            
            # Вычисляем количество битов в этом интервале
            beats_in_interval = int(round(interval / (60.0 / bpm)))
            
            # Проверяем, является ли этот downbeat границей структуры
            is_structure_boundary = False
            for struct_start in structure_section_starts:
                if abs(downbeat_time - struct_start) < 0.2:  # В пределах 0.2 секунды
                    is_structure_boundary = True
                    print(f"[DEBUG] ✓ Structure boundary detected at {downbeat_time:.2f}s (from Librosa/Essentia)", file=sys.stderr)
                    break
            
            # Если это граница структуры - создаем новую секцию
            if is_structure_boundary:
                # Завершаем предыдущую секцию (если она есть)
                if current_beats > 0:
                    prev_section = {
                        "type": current_type,
                        "start": current_start,
                        "beats": current_beats
                    }
                    grid.append(prev_section)
                    candidates_sections.append({
                        "time": current_start,
                        "type": current_type,
                        "beats": current_beats,
                        "reason": "structure_boundary_previous",
                        "action": "added"
                    })
                    print(f"[DEBUG] DECISION: Added previous {current_type} section at {current_start:.2f}s "
                          f"({current_beats} beats) - before structure boundary", file=sys.stderr)
                
                # Начинаем новую verse секцию на границе структуры
                current_start = downbeat_time
                current_type = "verse"
                current_beats = 0
                print(f"[DEBUG] DECISION: Starting new verse section at {downbeat_time:.2f}s (structure boundary)", file=sys.stderr)
            
            # Добавляем биты текущего интервала к текущей секции
            if current_type == "verse" and current_beats == 0:
                current_start = downbeat_time
            current_beats += beats_in_interval
    
    # РЕЖИМ 2: Fallback - используем старую RMS логику (если структура не найдена)
    else:
        print(f"[DEBUG] ===== FALLBACK MODE: Using RMS-based analysis (no structure boundaries) =====", file=sys.stderr)
        
        # Проходим по всем сильным долям
        for i in range(len(downbeats) - 1):
            interval = intervals[i]
            downbeat_time = downbeats[i]
            next_downbeat_time = downbeats[i + 1]
            
            # Вычисляем количество битов в этом интервале
            beats_in_interval = int(round(interval / (60.0 / bpm)))
            
            # Проверяем, является ли интервал "коротким"
            if interval < short_interval_threshold:
                # Это потенциальный мостик или брейк
                # Вычисляем RMS на этом участке
                segment_rms = calculate_rms(audio_data, sample_rate, downbeat_time, next_downbeat_time)
                
                print(f"[DEBUG] Short interval detected at {downbeat_time:.2f}s. "
                      f"RMS: {segment_rms:.4f}, Break threshold: {break_threshold:.4f}", file=sys.stderr)
                
                # Если громкость "ровная" (не пик) - это мостик
                if segment_rms < break_threshold:
                    # Завершаем предыдущую секцию (если она есть)
                    if current_beats > 0:
                        prev_section = {
                            "type": current_type,
                            "start": current_start,
                            "beats": current_beats
                        }
                        grid.append(prev_section)
                        candidates_sections.append({
                            "time": current_start,
                            "type": current_type,
                            "beats": current_beats,
                            "reason": "previous_section_end",
                            "action": "added"
                        })
                        print(f"[DEBUG] DECISION: Added previous {current_type} section at {current_start:.2f}s "
                              f"({current_beats} beats)", file=sys.stderr)
                    
                    # Начинаем мостик
                    # Выравниваем количество битов до кратности 4 (минимум 4)
                    beats_in_bridge = max(4, (beats_in_interval + 3) // 4 * 4)  # Округляем вверх до кратности 4
                    bridge_section = {
                        "type": "bridge",
                        "start": downbeat_time,
                        "beats": beats_in_bridge
                    }
                    grid.append(bridge_section)
                    candidates_sections.append({
                        "time": downbeat_time,
                        "type": "bridge",
                        "beats": beats_in_bridge,
                        "original_beats": beats_in_interval,
                        "reason": "short_interval_low_rms",
                        "action": "added"
                    })
                    print(f"[DEBUG] DECISION: Added BRIDGE section at {downbeat_time:.2f}s "
                          f"({beats_in_interval} beats -> {beats_in_bridge} beats after alignment)", file=sys.stderr)
                    
                    # Начинаем новую verse секцию после мостика
                    current_start = next_downbeat_time
                    current_type = "verse"
                    current_beats = 0
                else:
                    # Если это брейк (громкий участок), игнорируем и продолжаем verse
                    candidates_sections.append({
                        "time": downbeat_time,
                        "type": "break",
                        "beats": beats_in_interval,
                        "reason": "short_interval_high_rms",
                        "action": "ignored"
                    })
                    print(f"[DEBUG] DECISION: Ignoring potential bridge at {downbeat_time:.2f}s "
                          f"(high RMS: {segment_rms:.4f} > {break_threshold:.4f}) - treating as break", file=sys.stderr)
                    if current_type == "verse" and current_beats == 0:
                        current_start = downbeat_time
                    current_beats += beats_in_interval
            else:
                # Обычный интервал - продолжаем verse
                if current_type == "verse" and current_beats == 0:
                    current_start = downbeat_time
                
                current_beats += beats_in_interval
    
    # Добавляем последнюю секцию
    if current_beats > 0:
        grid.append({
            "type": current_type,
            "start": current_start,
            "beats": current_beats
        })
    
    # Если grid пустой, создаем одну verse секцию на весь трек
    if not grid:
        duration = len(audio_data) / sample_rate
        total_beats = int(round(duration * bpm / 60.0))
        grid.append({
            "type": "verse",
            "start": 0.0,
            "beats": total_beats
        })
    
    # ФИЛЬТРАЦИЯ МИКРО-СЕКЦИЙ И ВЫРАВНИВАНИЕ ПО КРАТНОСТИ 4
    # В бачате музыкальная фраза (секция) не может быть короче 4 beats (минимум один такт)
    # Обычно секции кратны 8 beats (полный цикл танца), но минимум 4 beats
    MIN_SECTION_BEATS = 4  # Минимальная длина секции в beats
    
    print(f"\n[DEBUG] Starting filtering process. Total sections before filtering: {len(grid)}", file=sys.stderr)
    print(f"[DEBUG] DEBUG_NO_FILTER = {DEBUG_NO_FILTER}", file=sys.stderr)
    
    filtered_grid = []
    for i, section in enumerate(grid):
        beats_count = section['beats']
        section_start = section['start']
        
        print(f"[DEBUG] Processing section #{i+1}: {section['type']} at {section_start:.2f}s, "
              f"{beats_count} beats", file=sys.stderr)
        
        # Если DEBUG_NO_FILTER включен, пропускаем фильтрацию
        if DEBUG_NO_FILTER:
            print(f"[DEBUG] DECISION: Keeping section at {section_start:.2f}s (DEBUG_NO_FILTER=True, no filtering)", file=sys.stderr)
            filtered_grid.append({
                "type": section['type'],
                "start": section['start'],
                "beats": beats_count
            })
            continue
        
        # Если секция короче минимума - вливаем в предыдущую
        if beats_count < MIN_SECTION_BEATS:
            print(f"[DEBUG] DECISION: Merging section at {section_start:.2f}s because duration ({beats_count} beats) < MIN_SECTION_LENGTH ({MIN_SECTION_BEATS})", file=sys.stderr)
            
            # Обновляем debug данные
            for candidate in candidates_sections:
                if abs(candidate['time'] - section_start) < 0.1:
                    candidate['action'] = 'merged'
                    candidate['reason'] = f'duration_too_short_{beats_count}_beats'
            
            # Если есть предыдущая секция, увеличиваем её длительность
            if filtered_grid:
                prev_section = filtered_grid[-1]
                prev_beats = prev_section['beats']
                prev_section['beats'] += beats_count
                print(f"[DEBUG]    → Merged into previous {prev_section['type']} section "
                      f"({prev_beats} -> {prev_section['beats']} beats)", file=sys.stderr)
            # Если нет предыдущей и это первая секция, пропускаем (начнем со следующей)
            elif i < len(grid) - 1:
                # Пытаемся влить в следующую секцию
                next_section = grid[i + 1]
                next_section['beats'] += beats_count
                next_section['start'] = section['start']  # Сдвигаем начало следующей секции
                print(f"[DEBUG]    → Will merge into next {next_section['type']} section", file=sys.stderr)
        else:
            # Выравниваем до кратности 4 (округляем вниз для стабильности)
            aligned_beats = (beats_count // 4) * 4
            if aligned_beats < MIN_SECTION_BEATS:
                aligned_beats = MIN_SECTION_BEATS
            
            if aligned_beats != beats_count:
                print(f"[DEBUG] DECISION: Aligning section at {section_start:.2f}s "
                      f"from {beats_count} to {aligned_beats} beats (multiple of 4)", file=sys.stderr)
            else:
                print(f"[DEBUG] DECISION: Keeping section at {section_start:.2f}s "
                      f"({beats_count} beats, already aligned)", file=sys.stderr)
            
            filtered_grid.append({
                "type": section['type'],
                "start": section['start'],
                "beats": aligned_beats
            })
    
    # Если после фильтрации осталась только одна секция или ничего, создаем одну verse
    if len(filtered_grid) <= 1:
        duration = len(audio_data) / sample_rate
        total_beats = int(round(duration * bpm / 60.0))
        # Выравниваем до кратности 4
        total_beats = (total_beats // 4) * 4
        filtered_grid = [{
            "type": "verse",
            "start": 0.0,
            "beats": max(MIN_SECTION_BEATS, total_beats)
        }]
        print(f"  ⚠ After filtering, only {len(filtered_grid)} section(s) left. "
              f"Using single verse section for entire track ({filtered_grid[0]['beats']} beats).", file=sys.stderr)
    
    # Финальная проверка: убеждаемся, что все секции >= MIN_SECTION_BEATS
    final_grid = []
    for section in filtered_grid:
        if section['beats'] >= MIN_SECTION_BEATS:
            final_grid.append(section)
        else:
            # Последний шанс: вливаем в предыдущую
            if final_grid:
                final_grid[-1]['beats'] += section['beats']
                print(f"[DEBUG] Final merge: {section['type']} section at {section['start']:.2f}s merged into previous", file=sys.stderr)
    
    # Сохраняем debug данные если передан debug_data
    if debug_data is not None:
        debug_data['candidates_sections'] = candidates_sections
    
    print(f"[DEBUG] Filtering complete. Total sections after filtering: {len(final_grid if final_grid else filtered_grid)}", file=sys.stderr)
    
    return final_grid if final_grid else filtered_grid


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
        # ПРИОРИТЕТ DRUMS: Если передан путь к drums, используем его для анализа ритма
        # Это уберет ложные срабатывания от вокала
        analysis_audio_path = drums_path if drums_path and os.path.exists(drums_path) else audio_path
        
        print(f"Using {'DRUMS' if analysis_audio_path == drums_path else 'ORIGINAL'} track for rhythm analysis", file=sys.stderr)
        
        # Загружаем аудио для анализа ритма (drums или оригинал)
        y_analysis, sr = librosa.load(analysis_audio_path, sr=None, mono=True)
        
        # Загружаем оригинальное аудио для RMS анализа (нужно для detect_bridges)
        y, sr_orig = librosa.load(audio_path, sr=None, mono=True)
        duration = len(y) / sr_orig
        
        print(f"Analyzing track with madmom: {audio_path}", file=sys.stderr)
        print(f"Duration: {duration:.2f}s, Sample rate: {sr}Hz", file=sys.stderr)
        print(f"Analysis audio shape: {y_analysis.shape}, Channels: {'mono' if y_analysis.ndim == 1 else 'stereo'}", file=sys.stderr)
        
        # Убеждаемся, что аудио для анализа в моно (1D массив)
        if y_analysis.ndim > 1:
            y_analysis = np.mean(y_analysis, axis=0)
            print("Converted analysis audio stereo to mono", file=sys.stderr)
        
        # Убеждаемся, что оригинальное аудио в моно (для RMS)
        if y.ndim > 1:
            y = np.mean(y, axis=0)
            print("Converted original audio stereo to mono", file=sys.stderr)
        
        # Madmom процессоры ожидают путь к файлу
        # Создаем временный моно файл для madmom из аудио для анализа
        import tempfile
        import soundfile as sf
        
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        
        # Сохраняем моно аудио для анализа во временный файл
        sf.write(tmp_path, y_analysis, sr)
        print(f"Created temporary mono file for madmom analysis: {tmp_path}", file=sys.stderr)
        
        try:
            # Создаем процессоры для детекции downbeats
            downbeat_processor = RNNDownBeatProcessor()
            
            print("=" * 80, file=sys.stderr)
            print("MADMOM ANALYSIS - Processing audio file...", file=sys.stderr)
            print("=" * 80, file=sys.stderr)
            
            # Обрабатываем аудио через временный моно файл
            print("Step 1: Running RNNDownBeatProcessor...", file=sys.stderr)
            act = downbeat_processor(tmp_path)
            # act - это numpy array с activation function
            # Форма: (frames, 2) где:
            #   - Первая колонка (act[:, 0]) - activation для beats
            #   - Вторая колонка (act[:, 1]) - activation для downbeats
            print(f"  ✓ Activation function shape: {act.shape}", file=sys.stderr)
            print(f"  ✓ Activation function dtype: {act.dtype}", file=sys.stderr)
            if act.size > 0:
                print(f"  ✓ Activation range: [{act.min():.4f}, {act.max():.4f}]", file=sys.stderr)
                print(f"  ✓ Activation mean: {act.mean():.4f}", file=sys.stderr)
                if len(act.shape) == 2:
                    print(f"  ✓ Activation frames: {act.shape[0]}, labels: {act.shape[1]}", file=sys.stderr)
                    print(f"  ✓ Beat activation (col 0) range: [{act[:, 0].min():.4f}, {act[:, 0].max():.4f}]", file=sys.stderr)
                    print(f"  ✓ Downbeat activation (col 1) range: [{act[:, 1].min():.4f}, {act[:, 1].max():.4f}]", file=sys.stderr)
            
            print("Step 2: Running DBNBeatTrackingProcessor for beats...", file=sys.stderr)
            # Используем первую колонку activation (beats) для beat tracking
            beat_processor = DBNBeatTrackingProcessor(fps=100)
            beat_times = beat_processor(act[:, 0])  # Используем только beat activation (первая колонка)
            print(f"  ✓ Detected {len(beat_times)} beats", file=sys.stderr)
            
            print("Step 2b: Assigning labels to beats (1=downbeat, 2-4=other)...", file=sys.stderr)
            # Используем downbeat activation для определения downbeats
            # Находим пики в downbeat activation и сопоставляем их с beat times
            from scipy.signal import find_peaks
            
            fps = 100  # FPS из RNNDownBeatProcessor
            downbeat_act = act[:, 1]
            
            # Находим пики в downbeat activation
            # Используем адаптивный порог
            threshold = np.percentile(downbeat_act, 70)  # Верхние 30% значений
            min_distance = max(10, int(fps * 0.5))  # Минимум 0.5 секунды между downbeats
            peaks, properties = find_peaks(downbeat_act, height=threshold, distance=min_distance)
            print(f"  ✓ Found {len(peaks)} downbeat peaks in activation", file=sys.stderr)
            
            # Преобразуем пики во времена
            peak_times = peaks / fps
            
            # Создаем массив beats с метками
            beats = []
            for i, beat_time in enumerate(beat_times):
                # Проверяем, является ли этот beat downbeat (близок к пику)
                is_downbeat = False
                for peak_time in peak_times:
                    if abs(beat_time - peak_time) < 0.1:  # В пределах 0.1 секунды
                        is_downbeat = True
                        break
                
                if is_downbeat:
                    label = 1  # Downbeat
                else:
                    # Определяем метку на основе позиции в такте (2-4)
                    # Находим ближайший предыдущий downbeat
                    prev_downbeats = [pt for pt in peak_times if pt < beat_time]
                    if prev_downbeats:
                        last_downbeat = max(prev_downbeats)
                        # Вычисляем позицию в такте (предполагаем 4/4)
                        beats_since_downbeat = (beat_time - last_downbeat) * (120 / 60)  # Предполагаем 120 BPM
                        label = int((beats_since_downbeat % 4) + 1)
                        if label == 1:
                            label = 2  # Если получилось 1, значит это не downbeat, делаем 2
                    else:
                        # Если нет предыдущих downbeats, используем простой паттерн
                        label = ((i % 4) + 1)
                
                beats.append((float(beat_time), int(label)))
            
            print(f"  ✓ Created {len(beats)} beats with labels", file=sys.stderr)
        finally:
            # Удаляем временный файл
            try:
                os.unlink(tmp_path)
            except:
                pass
        
        # Извлекаем downbeats (сильные доли) и обычные beats
        # beats содержит пары (время, метка), где метка 1 = сильная доля, 2-4 = остальные
        downbeats = []
        all_beats = []
        beat_labels_count = {1: 0, 2: 0, 3: 0, 4: 0}
        
        print("\nStep 3: Extracting beats and downbeats...", file=sys.stderr)
        for beat_time, beat_label in beats:
            all_beats.append(float(beat_time))
            if beat_label in beat_labels_count:
                beat_labels_count[beat_label] += 1
            if beat_label == 1:  # Сильная доля (единица)
                downbeats.append(float(beat_time))
        
        print(f"  ✓ Beat labels distribution:", file=sys.stderr)
        for label, count in sorted(beat_labels_count.items()):
            label_name = "Downbeat (1)" if label == 1 else f"Beat ({label})"
            print(f"    - {label_name}: {count} beats", file=sys.stderr)
        
        if len(downbeats) == 0:
            print("  ⚠ Warning: No downbeats detected, using every 4th beat as downbeat", file=sys.stderr)
            downbeats = all_beats[::4]  # Берем каждый 4-й удар как сильную долю
        
        if len(all_beats) == 0:
            raise ValueError("No beats detected")
        
        # Определяем BPM на основе интервалов между ударами
        if len(all_beats) > 1:
            beat_intervals = np.diff(all_beats)
            avg_interval = np.mean(beat_intervals)
            min_interval = np.min(beat_intervals)
            max_interval = np.max(beat_intervals)
            std_interval = np.std(beat_intervals)
            bpm = round(60.0 / avg_interval)
            
            print(f"\nStep 4: Calculating BPM from beat intervals...", file=sys.stderr)
            print(f"  ✓ Average interval: {avg_interval:.4f}s", file=sys.stderr)
            print(f"  ✓ Interval range: [{min_interval:.4f}s, {max_interval:.4f}s]", file=sys.stderr)
            print(f"  ✓ Interval std dev: {std_interval:.4f}s", file=sys.stderr)
        else:
            bpm = 120  # Значение по умолчанию
            print(f"\nStep 4: Using default BPM (only 1 beat detected)", file=sys.stderr)
        
        # Offset - время первого downbeat (сильной доли)
        offset = round(float(downbeats[0]) if len(downbeats) > 0 else all_beats[0], 3)
        
        print("\n" + "=" * 80, file=sys.stderr)
        print("MADMOM ANALYSIS RESULTS:", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        print(f"  BPM: {bpm}", file=sys.stderr)
        print(f"  Offset: {offset}s", file=sys.stderr)
        print(f"  Downbeats: {len(downbeats)}", file=sys.stderr)
        print(f"  Total beats: {len(all_beats)}", file=sys.stderr)
        
        # Выводим первые 10 beats для проверки
        print(f"\nFirst 10 beats detected:", file=sys.stderr)
        for i, (beat_time, beat_label) in enumerate(beats[:10]):
            label_name = "DOWNBEAT" if beat_label == 1 else f"beat-{beat_label}"
            print(f"  [{i+1:2d}] {beat_time:7.3f}s - {label_name}", file=sys.stderr)
        
        if len(beats) > 10:
            print(f"  ... and {len(beats) - 10} more beats", file=sys.stderr)
        
        # Выводим первые 10 downbeats
        if len(downbeats) > 0:
            print(f"\nFirst 10 downbeats:", file=sys.stderr)
            for i, db_time in enumerate(downbeats[:10]):
                print(f"  [{i+1:2d}] {db_time:7.3f}s", file=sys.stderr)
            if len(downbeats) > 10:
                print(f"  ... and {len(downbeats) - 10} more downbeats", file=sys.stderr)
        
        print("=" * 80, file=sys.stderr)
        
        # Подготавливаем debug данные
        debug_data = {
            'raw_beats': [float(bt) for bt in all_beats],
            'raw_downbeats': [float(db) for db in downbeats],
            'candidates_sections': []
        }
        
        # Step 5: Анализ структуры с помощью Essentia/Librosa
        print("\n" + "=" * 80, file=sys.stderr)
        print("Step 5: Analyzing structure (Essentia/Librosa)...", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        try:
            structure_boundaries = analyze_structure(audio_path)
            print(f"[Step 5] Structure analysis complete. Found {len(structure_boundaries)} boundaries", file=sys.stderr)
            debug_data['structure_boundaries'] = [float(b) for b in structure_boundaries]
        except Exception as e:
            print(f"[Step 5] ERROR: Structure analysis failed: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            structure_boundaries = []
            debug_data['structure_boundaries'] = []
        
        # Step 6: Объединение структуры с битами Madmom
        print("\n" + "=" * 80, file=sys.stderr)
        print("Step 6: Merging structure boundaries with Madmom beats...", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        try:
            merged_section_starts = merge_structure_with_beats(structure_boundaries, all_beats, downbeats, tolerance=0.5)
            print(f"[Step 6] Merge complete. Total merged section starts: {len(merged_section_starts)}", file=sys.stderr)
            debug_data['merged_section_starts'] = [float(s) for s in merged_section_starts]
        except Exception as e:
            print(f"[Step 6] ERROR: Merge failed: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            merged_section_starts = set()
            debug_data['merged_section_starts'] = []
        
        # Step 7: Детектирование мостиков с учетом объединенных границ
        # Используем оригинальное аудио (y) и его sample_rate (sr_orig) для RMS анализа
        print("\nStep 7: Detecting bridge sections (with merged structure boundaries)...", file=sys.stderr)
        grid = detect_bridges(downbeats, all_beats, y, sr_orig, bpm, debug_data, merged_section_starts)
        
        bridge_count = len([s for s in grid if s['type'] == 'bridge'])
        verse_count = len([s for s in grid if s['type'] == 'verse'])
        
        print(f"  ✓ Detected {bridge_count} bridge sections, {verse_count} verse sections", file=sys.stderr)
        
        if grid:
            print(f"\nGrid sections breakdown:", file=sys.stderr)
            for i, section in enumerate(grid):
                section_end = section['start'] + (section['beats'] * (60.0 / bpm))
                print(f"  [{i+1:2d}] {section['type'].upper():6s} | "
                      f"Start: {section['start']:7.3f}s | "
                      f"Beats: {section['beats']:3d} | "
                      f"End: {section_end:7.3f}s", file=sys.stderr)
        
        print("=" * 80, file=sys.stderr)
        
        # Сохраняем debug файл
        try:
            audio_dir = os.path.dirname(os.path.abspath(audio_path))
            if not audio_dir:
                # Если путь относительный или нет директории, используем текущую
                audio_dir = os.getcwd()
            
            debug_file_path = os.path.join(audio_dir, 'analysis_debug.json')
            
            debug_output = {
                'audio_path': audio_path,
                'bpm': bpm,
                'offset': offset,
                'duration': duration,
                'raw_beats': debug_data['raw_beats'],
                'raw_downbeats': debug_data['raw_downbeats'],
                'candidates_sections': debug_data['candidates_sections'],
                'final_grid': grid,
                'total_beats': len(all_beats),
                'total_downbeats': len(downbeats),
                'debug_no_filter': DEBUG_NO_FILTER
            }
            
            with open(debug_file_path, 'w', encoding='utf-8') as f:
                json.dump(debug_output, f, indent=2, ensure_ascii=False)
            
            print(f"\n[DEBUG] Debug file saved: {debug_file_path}", file=sys.stderr)
        except Exception as e:
            print(f"[DEBUG] Warning: Failed to save debug file: {e}", file=sys.stderr)
        
        return {
            'bpm': bpm,
            'offset': offset,
            'duration': duration,
            'grid': grid,
            'downbeats': downbeats,  # Массив времен downbeats (сильных долей)
            'totalBeats': len(all_beats)  # Общее количество beats для справки
        }
        
    except Exception as e:
        print(f"Error in madmom analysis: {str(e)}", file=sys.stderr)
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

