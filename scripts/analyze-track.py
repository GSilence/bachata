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
    Анализирует структуру трека с помощью Essentia используя NoveltyCurve
    Находит границы секций (boundaries) где меняется гармония/структура музыки
    
    Использует стандартный алгоритм Music Segmentation:
    1. Вычисляет MFCC (Mel-frequency cepstral coefficients)
    2. Вычисляет NoveltyCurve на основе MFCC
    3. Находит пики на кривой - это моменты смены музыкальных секций
    
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
        duration = len(audio) / sample_rate
        
        print(f"[Essentia] Audio loaded: {len(audio)} samples, {duration:.2f}s", file=sys.stderr)
        
        # Параметры для анализа
        # Для больших треков используем увеличенный hop_size для экономии памяти
        MAX_DURATION_FOR_FULL_ANALYSIS = 180  # секунд
        
        if duration > MAX_DURATION_FOR_FULL_ANALYSIS:
            print(f"[Essentia] Track duration ({duration:.1f}s) exceeds safe limit ({MAX_DURATION_FOR_FULL_ANALYSIS}s).", file=sys.stderr)
            print(f"[Essentia] Using downsampled analysis for memory efficiency...", file=sys.stderr)
            frame_size = 2048
            hop_size = 2048  # Увеличенный hop_size для экономии памяти
        else:
            frame_size = 2048
            hop_size = 512  # Стандартный hop_size для точности
        
        # Шаг 1: Вычисляем MFCC features
        print("[Essentia] Computing MFCC features for structure analysis...", file=sys.stderr)
        mfcc = es.MFCC()
        windowing = es.Windowing(type='hann')
        spectrum = es.Spectrum()
        
        frames = es.FrameGenerator(audio, frameSize=frame_size, hopSize=hop_size)
        
        mfccs = []
        for frame in frames:
            spec = spectrum(windowing(frame))
            mfcc_coeffs, mfcc_bands = mfcc(spec)
            mfccs.append(mfcc_coeffs)
        
        mfccs = np.array(mfccs)
        print(f"[Essentia] Computed {len(mfccs)} MFCC frames", file=sys.stderr)
        
        # Шаг 2: Вычисляем NoveltyCurve
        # NoveltyCurve показывает, насколько "новым" является каждый момент времени
        # Пики на кривой соответствуют моментам смены музыкальных секций
        print("[Essentia] Computing NoveltyCurve from MFCC...", file=sys.stderr)
        
        # Параметры для NoveltyCurve
        # Kernel size определяет размер окна для сравнения
        # Больший kernel = менее чувствителен к отдельным ударам, более чувствителен к смене квадратов
        # Для бачаты: квадрат = 8 beats, при 120 BPM это ~4 секунды
        # При hop_size=512: 4 секунды = ~345 кадров
        # При hop_size=2048: 4 секунды = ~86 кадров
        beats_per_bar = 4  # Бачата обычно 4/4
        bars_per_section = 4  # Увеличиваем до 4 тактов (квадрат) для стабильности
        seconds_per_section = (beats_per_bar * bars_per_section) * (60.0 / 120.0)  # ~8 секунд при 120 BPM
        frames_per_section = int(seconds_per_section * sample_rate / hop_size)
        
        # Kernel size должен быть достаточно большим, чтобы не реагировать на отдельные удары
        # Увеличиваем kernel_size чтобы видеть структуру, а не ритм
        # Минимум 100 кадров, максимум 300 кадров (больше чем раньше)
        kernel_size = max(100, min(frames_per_section // 2, 300))  # От 100 до 300 кадров
        
        print(f"[Essentia] NoveltyCurve parameters: kernel_size={kernel_size}, hop_size={hop_size}", file=sys.stderr)
        
        # Вычисляем NoveltyCurve вручную, так как в Essentia нет прямой функции
        # NoveltyCurve = сумма квадратов разностей между соседними окнами MFCC
        novelty_curve = []
        
        for i in range(len(mfccs) - kernel_size):
            # Сравниваем текущее окно с предыдущим
            current_window = mfccs[i:i+kernel_size]
            previous_window = mfccs[max(0, i-kernel_size):i] if i >= kernel_size else mfccs[0:i]
            
            if len(previous_window) > 0:
                # Вычисляем средние значения MFCC для окон
                current_mean = np.mean(current_window, axis=0)
                previous_mean = np.mean(previous_window, axis=0)
                
                # Novelty = евклидово расстояние между средними
                novelty = np.linalg.norm(current_mean - previous_mean)
                novelty_curve.append(novelty)
            else:
                novelty_curve.append(0.0)
        
        # Добавляем нули в начало для выравнивания
        novelty_curve = [0.0] * kernel_size + novelty_curve
        novelty_curve = np.array(novelty_curve)
        
        print(f"[Essentia] NoveltyCurve computed: {len(novelty_curve)} points", file=sys.stderr)
        print(f"[Essentia] NoveltyCurve range: [{np.min(novelty_curve):.4f}, {np.max(novelty_curve):.4f}]", file=sys.stderr)
        
        # Шаг 3: Находим пики на NoveltyCurve
        # Пики соответствуют моментам смены музыкальных секций
        print("[Essentia] Finding peaks in NoveltyCurve...", file=sys.stderr)
        
        from scipy.signal import find_peaks
        
        # Порог для пиков: используем процентиль для адаптации к разным трекам
        # Повышаем порог для снижения чувствительности (меньше ложных срабатываний)
        peak_height = np.percentile(novelty_curve, 70)  # 70-й процентиль (было 60)
        
        # Минимальное расстояние между пиками: минимум 4 секунды
        # Секции в Бачате не меняются чаще, чем раз в квадрат (8 счетов = ~4 секунды при 120 BPM)
        min_distance_frames = int(sample_rate / hop_size * 4)  # 4 секунды (было 2)
        
        # Prominence (значимость пика) - игнорируем мелкую рябь
        # Вычисляем prominence как процент от диапазона кривой
        # УМЕНЬШЕНО до 0.02 (2% от диапазона) для максимальной чувствительности (замечать даже небольшие изменения)
        curve_range = np.max(novelty_curve) - np.min(novelty_curve)
        prominence_threshold = curve_range * 0.02  # 2% от диапазона - очень чувствительно для обнаружения мостиков
        
        # УМЕНЬШЕНО distance до 40 фреймов (примерно 1 секунда)
        # Это позволит замечать короткие вставки (мостики)
        # Лучше найти лишние границы (которые потом отфильтруем), чем пропустить реальный мостик
        min_distance_frames = 40  # Фиксированное значение ~1 секунда (независимо от hop_size)
        
        peaks, properties = find_peaks(novelty_curve,
                                      height=peak_height,
                                      distance=min_distance_frames,
                                      prominence=prominence_threshold)
        
        print(f"[Essentia] Found {len(peaks)} peaks in NoveltyCurve", file=sys.stderr)
        print(f"[Essentia] Peak detection params: height>={peak_height:.4f}, distance>={min_distance_frames} frames (~{min_distance_frames * hop_size / sample_rate:.1f}s), prominence>={prominence_threshold:.4f} ({prominence_threshold/curve_range*100:.1f}% of range)", file=sys.stderr)
        
        # Преобразуем индексы пиков во временные метки
        frame_times = np.arange(len(mfccs)) * (hop_size / sample_rate)
        boundaries = frame_times[peaks].tolist()
        
        print(f"[Essentia] Found {len(boundaries)} structural boundaries: {[f'{b:.2f}s' for b in boundaries[:10]]}", file=sys.stderr)
        
        return boundaries
        
    except MemoryError as e:
        print(f"[Essentia] Memory error during structure analysis: {e}", file=sys.stderr)
        print(f"[Essentia] ERROR: Insufficient memory. Please:", file=sys.stderr)
        print(f"[Essentia] 1. Add swap memory to the server (recommended)", file=sys.stderr)
        print(f"[Essentia] 2. Or increase memory limits in systemd service", file=sys.stderr)
        print(f"[Essentia] 3. See docs/ESSENTIA_SETUP.md for instructions", file=sys.stderr)
        # Пробрасываем исключение дальше, чтобы пользователь знал о проблеме
        raise
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
    
    # ВАЖНО: Объединяем результаты Essentia (структурные границы) и RMS (громкость)
    # Оба метода дополняют друг друга:
    # - Essentia находит смену гармонии/структуры
    # - RMS находит затихания/брейки (fade outs/breaks)
    print(f"[DEBUG] Combined mode: Using {len(structure_section_starts)} structure boundaries from Essentia/Librosa", file=sys.stderr)
    print(f"[DEBUG] RMS analysis ENABLED - combining structural boundaries with volume-based detection", file=sys.stderr)
    
    # Вычисляем средний интервал между сильными долями (обычно 8 битов = 4 такта)
    intervals = np.diff(downbeats)
    avg_interval = np.mean(intervals)
    
    # Вычисляем среднюю RMS энергию по всему треку
    total_rms = calculate_rms(audio_data, sample_rate, 0, len(audio_data) / sample_rate)
    
    # Определяем порог для "короткого" интервала (обычно 4 бита вместо 8)
    # Если интервал меньше 60% от среднего, это потенциальный мостик
    short_interval_threshold = avg_interval * 0.6
    
    # Определяем порог для "тихого" участка (break/fade out)
    # Если RMS меньше 0.7x от среднего, это затихание/брейк
    break_threshold = total_rms * 0.7
    
    print(f"[DEBUG] RMS thresholds: total_rms={total_rms:.4f}, break_threshold={break_threshold:.4f}", file=sys.stderr)
    
    # Вычисляем интервалы
    intervals = np.diff(downbeats)
    
    grid = []
    current_start = 0.0
    current_type = "verse"
    current_beats = 0
    
    # ОБЪЕДИНЕННЫЙ РЕЖИМ: Используем и Essentia границы, и RMS анализ
    print(f"[DEBUG] ===== COMBINED MODE: Using Essentia boundaries + RMS analysis =====", file=sys.stderr)
    
    # Проходим по всем сильным долям
    for i in range(len(downbeats) - 1):
        interval = intervals[i]
        downbeat_time = downbeats[i]
        next_downbeat_time = downbeats[i + 1]
        
        # Вычисляем количество битов в этом интервале
        beats_in_interval = int(round(interval / (60.0 / bpm)))
        
        # Проверяем, является ли этот downbeat границей структуры от Essentia
        is_structure_boundary = False
        for struct_start in structure_section_starts:
            if abs(downbeat_time - struct_start) < 0.2:  # В пределах 0.2 секунды
                is_structure_boundary = True
                print(f"[DEBUG] ✓ Essentia structure boundary detected at {downbeat_time:.2f}s", file=sys.stderr)
                break
        
        # Проверяем RMS для обнаружения затиханий/брейков
        # Важно: считаем секцию "тихой ямой" только если RMS низкий минимум 1 секунду
        # Кратковременное затихание между ударами не должно считаться брейком
        is_break_detected = False
        segment_rms = None
        
        # Вычисляем RMS на текущем участке
        segment_rms = calculate_rms(audio_data, sample_rate, downbeat_time, next_downbeat_time)
        
        # Проверяем, что RMS низкий на протяжении минимум 1 секунды
        # Для этого проверяем текущий интервал и следующие интервалы, пока не наберем 1 секунду
        if segment_rms < break_threshold:
            # Проверяем следующие интервалы, чтобы убедиться, что затихание длится минимум 1 секунду
            total_low_rms_duration = interval
            checked_intervals = 1
            min_break_duration = 1.0  # Минимум 1 секунда
            
            # Проверяем следующие интервалы, пока не наберем 1 секунду или не закончатся интервалы
            j = i + 1
            while total_low_rms_duration < min_break_duration and j < len(downbeats) - 1:
                next_interval = intervals[j]
                next_start = downbeats[j]
                next_end = downbeats[j + 1]
                
                # Вычисляем RMS следующего интервала
                next_rms = calculate_rms(audio_data, sample_rate, next_start, next_end)
                
                if next_rms < break_threshold:
                    total_low_rms_duration += next_interval
                    checked_intervals += 1
                    j += 1
                else:
                    # Если RMS поднялся выше порога - прерываем проверку
                    break
            
            # Считаем break только если затихание длится минимум 1 секунду
            if total_low_rms_duration >= min_break_duration:
                is_break_detected = True
                print(f"[DEBUG] ✓ RMS break detected at {downbeat_time:.2f}s "
                      f"(RMS: {segment_rms:.4f} < {break_threshold:.4f}, "
                      f"duration: {total_low_rms_duration:.2f}s, checked {checked_intervals} intervals)", file=sys.stderr)
            else:
                print(f"[DEBUG] ✗ RMS low but too short at {downbeat_time:.2f}s "
                      f"(RMS: {segment_rms:.4f} < {break_threshold:.4f}, "
                      f"duration: {total_low_rms_duration:.2f}s < {min_break_duration}s) - ignoring", file=sys.stderr)
        
        # Объединяем результаты: новая секция если есть граница Essentia ИЛИ RMS break
        is_new_section = is_structure_boundary or is_break_detected
        
        if is_new_section:
            # Завершаем предыдущую секцию (если она есть)
            if current_beats > 0:
                prev_section = {
                    "type": current_type,
                    "start": current_start,
                    "beats": current_beats
                }
                grid.append(prev_section)
                reason = []
                if is_structure_boundary:
                    reason.append("essentia_boundary")
                if is_break_detected:
                    reason.append("rms_break")
                
                candidates_sections.append({
                    "time": current_start,
                    "type": current_type,
                    "beats": current_beats,
                    "reason": "_".join(reason) + "_previous",
                    "action": "added"
                })
                print(f"[DEBUG] DECISION: Added previous {current_type} section at {current_start:.2f}s "
                      f"({current_beats} beats) - before {'+'.join(reason)}", file=sys.stderr)
            
            # Определяем тип новой секции
            if is_break_detected:
                # Если это затихание - помечаем как bridge
                # Выравниваем количество битов до кратности 4 (минимум 4)
                beats_in_bridge = max(4, (beats_in_interval + 3) // 4 * 4)
                
                bridge_section = {
                    "type": "bridge",
                    "start": downbeat_time,
                    "beats": beats_in_bridge
                }
                grid.append(bridge_section)
                
                reason_parts = []
                if is_structure_boundary:
                    reason_parts.append("essentia")
                reason_parts.append("rms_break")
                
                candidates_sections.append({
                    "time": downbeat_time,
                    "type": "bridge",
                    "beats": beats_in_bridge,
                    "original_beats": beats_in_interval,
                    "reason": "_".join(reason_parts),
                    "action": "added"
                })
                
                print(f"[DEBUG] DECISION: Added BRIDGE section at {downbeat_time:.2f}s "
                      f"({beats_in_interval} beats -> {beats_in_bridge} beats, "
                      f"RMS: {segment_rms:.4f} < {break_threshold:.4f})", file=sys.stderr)
                
                # После bridge начинаем новую verse секцию со следующего интервала
                current_start = next_downbeat_time
                current_type = "verse"
                current_beats = 0
            else:
                # Если это только структурная граница (без RMS break) - начинаем verse
                current_type = "verse"
                current_start = downbeat_time
                current_beats = beats_in_interval
                print(f"[DEBUG] DECISION: Starting VERSE section at {downbeat_time:.2f}s (Essentia boundary only)", file=sys.stderr)
        else:
            # Обычный интервал - продолжаем текущую секцию
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
    
    # ПОСТ-ОБРАБОТКА: Фильтрация близких границ + Musical Quantization
    # Этап 1: Musical Quantization - убираем секции короче 4-х битов (музыкально некорректные)
    # Этап 2: Фильтрация близких границ по времени
    print(f"\n[DEBUG] Post-processing: Musical Quantization + Filtering boundaries...", file=sys.stderr)
    print(f"[DEBUG] Total sections before post-processing: {len(grid)}", file=sys.stderr)
    
    # Параметры для Musical Quantization
    MIN_SECTION_BEATS_QUANTIZATION = 3.5  # Минимум 3.5 битов (с погрешностью для 4-х битов)
    MIN_BOUNDARY_DISTANCE = 3.0  # Минимум 3 секунды между границами (для фильтрации по времени)
    MAX_SECTION_DURATION_FOR_MERGE = 4.0  # Не объединяем секции длиннее 4 секунд
    
    # Вычисляем длительность одного бита в секундах
    beat_interval = 60.0 / bpm
    seconds_per_beat = beat_interval
    
    if len(grid) > 1:
        filtered_grid = [grid[0]]  # Всегда оставляем первую секцию
        
        for i in range(1, len(grid)):
            current_section = grid[i]
            current_start = current_section['start']
            prev_section = filtered_grid[-1]
            prev_start = prev_section['start']
            
            distance = current_start - prev_start
            
            # ЭТАП 1: Musical Quantization - проверяем длительность в БИТАХ
            # Рассчитываем длительность текущей секции в битах (от предыдущей границы до текущей)
            # Это более точно, чем использовать beats из секции, так как учитывает реальное время
            current_beats_duration = distance / seconds_per_beat
            
            # ПРИОРИТЕТ 1: Если секция короче 3.5 битов - БЕЗУСЛОВНО объединяем
            # Это убирает "дребезг" (1-2-1-2) и случайные сбросы посреди такта
            if current_beats_duration < MIN_SECTION_BEATS_QUANTIZATION:
                print(f"[DEBUG] Musical Quantization: Merging section at {current_start:.2f}s "
                      f"(duration: {current_beats_duration:.2f} beats < {MIN_SECTION_BEATS_QUANTIZATION} beats - musically incorrect)", file=sys.stderr)
                
                prev_section['beats'] += current_section['beats']
                print(f"[DEBUG]   → Merged {current_section['beats']} beats into previous section at {prev_start:.2f}s "
                      f"({prev_section['beats']} beats total)", file=sys.stderr)
                continue  # Пропускаем добавление текущей секции
            
            # Вычисляем длительность предыдущей секции в секундах (для проверки MAX_SECTION_DURATION_FOR_MERGE)
            prev_section_duration = prev_section['beats'] * beat_interval
            
            # ЭТАП 2: Фильтрация близких границ по времени (если не сработала Musical Quantization)
            if distance < MIN_BOUNDARY_DISTANCE and prev_section_duration < MAX_SECTION_DURATION_FOR_MERGE:
                # Две границы слишком близко И предыдущая секция короткая - удаляем текущую
                # Объединяем beats текущей секции с предыдущей
                print(f"[DEBUG] Removing close boundary: {current_start:.2f}s (too close to {prev_start:.2f}s, "
                      f"distance: {distance:.2f}s < {MIN_BOUNDARY_DISTANCE}s, "
                      f"prev section duration: {prev_section_duration:.2f}s < {MAX_SECTION_DURATION_FOR_MERGE}s)", file=sys.stderr)
                
                prev_section['beats'] += current_section['beats']
                print(f"[DEBUG]   → Merged {current_section['beats']} beats into previous section at {prev_start:.2f}s "
                      f"({prev_section['beats']} beats total)", file=sys.stderr)
            elif distance < MIN_BOUNDARY_DISTANCE and prev_section_duration >= MAX_SECTION_DURATION_FOR_MERGE:
                # Границы близко, но предыдущая секция уже длинная - НЕ объединяем
                # Это позволяет разбить "Гига-Куплет" на части
                print(f"[DEBUG] Keeping boundary: {current_start:.2f}s (close to {prev_start:.2f}s, "
                      f"distance: {distance:.2f}s < {MIN_BOUNDARY_DISTANCE}s, "
                      f"BUT prev section duration: {prev_section_duration:.2f}s >= {MAX_SECTION_DURATION_FOR_MERGE}s - NOT merging)", file=sys.stderr)
                filtered_grid.append(current_section)
            else:
                # Нормальная секция - добавляем её
                filtered_grid.append(current_section)
        
        grid = filtered_grid
        print(f"[DEBUG] Post-processing complete. Total sections after filtering: {len(grid)}", file=sys.stderr)
    else:
        print(f"[DEBUG] Post-processing skipped (only {len(grid)} section)", file=sys.stderr)
    
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
    
    # ВТОРОЙ ПРОХОД ФИЛЬТРАЦИИ: Musical Quantization 2.0
    # Убираем секции с длительностью, которая ломает танцевальный счет (1-8)
    # Проблема: секции длиной 6 или 10 битов остаются после первого прохода
    print(f"\n[DEBUG] Second Pass: Musical Quantization 2.0 - fixing sections that break dance count (1-8)...", file=sys.stderr)
    print(f"[DEBUG] Total sections before second pass: {len(final_grid if final_grid else filtered_grid)}", file=sys.stderr)
    
    # Используем final_grid если он не пустой, иначе filtered_grid
    sections_to_process = final_grid if final_grid else filtered_grid
    second_pass_grid = []
    
    # Вычисляем среднюю RMS энергию для определения "явной тишины"
    total_rms = calculate_rms(audio_data, sample_rate, 0, len(audio_data) / sample_rate)
    break_threshold = total_rms * 0.7  # Порог для тишины (break/bridge)
    
    for i, section in enumerate(sections_to_process):
        beats_duration = section['beats']
        section_start = section['start']
        section_type = section['type']
        
        # Вычисляем остаток от деления на 4
        remainder = beats_duration % 4
        
        # Правило: Если beats_duration % 4 >= 2 (например, 6, 10, 14 битов)
        # Это значит граница стоит "посередине" такта - удаляем её
        if remainder >= 2:
            # Исключение: Если это явная тишина (Bridge) с очень низким RMS
            is_explicit_break = False
            if section_type == 'bridge':
                # Вычисляем конец секции
                beat_interval = 60.0 / bpm
                section_end = section_start + (beats_duration * beat_interval)
                segment_rms = calculate_rms(audio_data, sample_rate, section_start, section_end)
                
                if segment_rms < break_threshold:
                    is_explicit_break = True
                    print(f"[DEBUG] Second Pass: Keeping bridge at {section_start:.2f}s "
                          f"({beats_duration} beats, remainder={remainder}) - explicit break "
                          f"(RMS: {segment_rms:.4f} < {break_threshold:.4f})", file=sys.stderr)
            
            if not is_explicit_break:
                # Удаляем границу - объединяем с предыдущей секцией
                print(f"[DEBUG] Second Pass: Removing boundary at {section_start:.2f}s "
                      f"({beats_duration} beats, remainder={remainder} >= 2) - merging with previous section", file=sys.stderr)
                
                if second_pass_grid:
                    # Объединяем с предыдущей секцией
                    prev_section = second_pass_grid[-1]
                    prev_section['beats'] += beats_duration
                    print(f"[DEBUG]   → Merged {beats_duration} beats into previous {prev_section['type']} section "
                          f"at {prev_section['start']:.2f}s ({prev_section['beats']} beats total)", file=sys.stderr)
                else:
                    # Если это первая секция, оставляем как есть (начнем со следующей)
                    print(f"[DEBUG]   → First section, keeping as is", file=sys.stderr)
                    second_pass_grid.append(section)
            else:
                # Явная тишина - оставляем как есть
                second_pass_grid.append(section)
        else:
            # Если remainder < 2 (например, 5, 9, 13 битов) - это погрешность, оставляем как есть
            # Фронтенд сам притянет к ближайшему биту (у нас там есть snap)
            if remainder > 0:
                print(f"[DEBUG] Second Pass: Keeping section at {section_start:.2f}s "
                      f"({beats_duration} beats, remainder={remainder} < 2) - small error, frontend will snap", file=sys.stderr)
            second_pass_grid.append(section)
    
    # Обновляем final_grid результатами второго прохода
    final_grid = second_pass_grid
    print(f"[DEBUG] Second Pass complete. Total sections after second pass: {len(final_grid)}", file=sys.stderr)
    
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

