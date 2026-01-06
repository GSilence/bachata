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


class EnergyDropDetector:
    """
    Детектор провалов энергии для поиска тихих мостиков (Bridges) в бачате.
    
    Ищет участки, где пропадает вокал или падает энергия на ~4 счета,
    характерные для мостиков в бачате.
    """
    
    def __init__(self, audio_data, sample_rate, bpm, 
                 vocal_range=(300, 3000),
                 drop_threshold=0.6,
                 min_duration_beats=3.0,
                 max_duration_beats=5.0):
        """
        Инициализация детектора.
        
        Args:
            audio_data: numpy array с аудио данными (моно)
            sample_rate: частота дискретизации
            bpm: BPM трека
            vocal_range: кортеж (low, high) - диапазон частот голоса в Гц
            drop_threshold: порог падения энергии (0.6 = 60% от локального среднего)
            min_duration_beats: минимальная длительность провала в битах
            max_duration_beats: максимальная длительность провала в битах
        """
        self.audio_data = audio_data
        self.sample_rate = sample_rate
        self.bpm = bpm
        self.vocal_range = vocal_range
        self.drop_threshold = drop_threshold
        self.min_duration_beats = min_duration_beats
        self.max_duration_beats = max_duration_beats
        
        # Вычисляем длительность бита в секундах
        self.beat_interval = 60.0 / bpm
        
        print(f"[EnergyDrop] Initialized: BPM={bpm}, vocal_range={vocal_range}Hz, "
              f"drop_threshold={drop_threshold}, duration_range=[{min_duration_beats}, {max_duration_beats}] beats",
              file=sys.stderr)
    
    def find_bridges(self):
        """
        Находит мостики (провалы энергии) в аудио.
        
        Алгоритм:
        A. Применяет Band-pass фильтр для выделения вокального диапазона
        B. Вычисляет RMS огибающую отфильтрованного сигнала
        C. Находит участки, где RMS падает ниже порога относительно скользящего среднего
        D. Валидирует найденные участки по длительности
        
        Returns:
            list: список временных меток (start_times) найденных провалов в секундах
        """
        try:
            print(f"[EnergyDrop] Starting bridge detection...", file=sys.stderr)
            
            # Шаг A: Band-pass фильтрация для выделения вокального диапазона
            print(f"[EnergyDrop] Step A: Applying band-pass filter ({self.vocal_range[0]}-{self.vocal_range[1]}Hz)...", file=sys.stderr)
            nyquist = self.sample_rate / 2.0
            low = self.vocal_range[0] / nyquist
            high = self.vocal_range[1] / nyquist
            
            # Убеждаемся, что частоты в допустимом диапазоне [0, 1]
            low = max(0.01, min(0.99, low))
            high = max(0.01, min(0.99, high))
            
            if low >= high:
                print(f"[EnergyDrop] WARNING: Invalid frequency range, skipping filter", file=sys.stderr)
                filtered_audio = self.audio_data
            else:
                # Создаем Butterworth band-pass фильтр
                sos = signal.butter(4, [low, high], btype='band', output='sos')
                filtered_audio = signal.sosfilt(sos, self.audio_data)
            
            print(f"[EnergyDrop] Filter applied. Filtered audio shape: {filtered_audio.shape}", file=sys.stderr)
            
            # Шаг B: Вычисление RMS огибающей
            # Размер окна = 0.5 бита
            window_size_seconds = 0.5 * self.beat_interval
            window_size_samples = int(window_size_seconds * self.sample_rate)
            
            # Минимум 10 сэмплов для окна
            window_size_samples = max(10, window_size_samples)
            
            print(f"[EnergyDrop] Step B: Computing RMS envelope (window={window_size_samples} samples, {window_size_seconds:.3f}s)...", file=sys.stderr)
            
            # Вычисляем RMS для каждого окна
            rms_envelope = []
            num_windows = len(filtered_audio) // window_size_samples
            
            for i in range(num_windows):
                start_idx = i * window_size_samples
                end_idx = start_idx + window_size_samples
                window = filtered_audio[start_idx:end_idx]
                rms = np.sqrt(np.mean(window ** 2))
                rms_envelope.append(rms)
            
            # Добавляем остаток
            if len(filtered_audio) % window_size_samples > 0:
                remainder = filtered_audio[num_windows * window_size_samples:]
                if len(remainder) > 0:
                    rms = np.sqrt(np.mean(remainder ** 2))
                    rms_envelope.append(rms)
            
            rms_envelope = np.array(rms_envelope)
            
            # Временные метки для каждого окна RMS
            rms_times = np.arange(len(rms_envelope)) * window_size_seconds
            
            print(f"[EnergyDrop] RMS envelope computed: {len(rms_envelope)} points, "
                  f"range=[{rms_envelope.min():.6f}, {rms_envelope.max():.6f}]", file=sys.stderr)
            
            # Шаг C: Поиск провалов (ям) в RMS
            # Используем скользящее среднее для контекста (~8 битов)
            context_window_beats = 8.0
            context_window_seconds = context_window_beats * self.beat_interval
            context_window_samples = int(context_window_seconds / window_size_seconds)
            context_window_samples = max(1, context_window_samples)
            
            print(f"[EnergyDrop] Step C: Finding energy drops (context window={context_window_samples} RMS samples, ~{context_window_beats} beats)...", file=sys.stderr)
            
            # Вычисляем скользящее среднее
            if len(rms_envelope) < context_window_samples:
                print(f"[EnergyDrop] WARNING: RMS envelope too short for context window, skipping", file=sys.stderr)
                return []
            
            # Используем симметричное скользящее среднее для контекста
            # Окно центрировано вокруг текущей точки (половина окна до, половина после)
            half_window = context_window_samples // 2
            moving_avg = np.zeros_like(rms_envelope)
            for i in range(len(rms_envelope)):
                start_idx = max(0, i - half_window)
                end_idx = min(len(rms_envelope), i + half_window + 1)
                moving_avg[i] = np.mean(rms_envelope[start_idx:end_idx])
            
            # Находим участки, где RMS падает ниже порога
            threshold_values = moving_avg * self.drop_threshold
            is_drop = rms_envelope < threshold_values
            
            print(f"[EnergyDrop] Found {np.sum(is_drop)} RMS samples below threshold", file=sys.stderr)
            
            # Группируем смежные провалы в непрерывные участки
            drop_regions = []
            in_drop = False
            drop_start_idx = None
            
            for i in range(len(is_drop)):
                if is_drop[i] and not in_drop:
                    # Начало провала
                    in_drop = True
                    drop_start_idx = i
                elif not is_drop[i] and in_drop:
                    # Конец провала
                    in_drop = False
                    drop_regions.append((drop_start_idx, i - 1))
            
            # Если провал продолжается до конца
            if in_drop:
                drop_regions.append((drop_start_idx, len(is_drop) - 1))
            
            print(f"[EnergyDrop] Found {len(drop_regions)} potential drop regions", file=sys.stderr)
            
            # Шаг D: Валидация по длительности
            print(f"[EnergyDrop] Step D: Validating drop regions by duration...", file=sys.stderr)
            valid_bridges = []
            
            for start_idx, end_idx in drop_regions:
                # Вычисляем длительность в битах
                start_time = rms_times[start_idx]
                end_time = rms_times[end_idx] + window_size_seconds  # Добавляем размер окна для конца
                duration_seconds = end_time - start_time
                duration_beats = duration_seconds / self.beat_interval
                
                # Проверяем, попадает ли длительность в вилку
                if self.min_duration_beats <= duration_beats <= self.max_duration_beats:
                    valid_bridges.append(start_time)
                    print(f"[EnergyDrop] Valid bridge found: {start_time:.3f}s, duration={duration_beats:.2f} beats ({duration_seconds:.3f}s)", file=sys.stderr)
                else:
                    print(f"[EnergyDrop] Rejected drop region: {start_time:.3f}s, duration={duration_beats:.2f} beats (outside range [{self.min_duration_beats}, {self.max_duration_beats}])", file=sys.stderr)
            
            print(f"[EnergyDrop] Bridge detection complete. Found {len(valid_bridges)} valid bridges", file=sys.stderr)
            return valid_bridges
            
        except Exception as e:
            print(f"[EnergyDrop] ERROR during bridge detection: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return []


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


def detect_bridges(downbeats, beats, audio_data, sample_rate, bpm, debug_data=None, structure_section_starts=None, offset=None, duration=None):
    """
    Формирует сетку секций (grid) с идеальным счетом 1-8.
    
    Логика:
    1. Квантование: Все границы от Essentia притягиваются к ближайшему "Раз" (первый бит такта)
    2. Длительность: Считается длина каждой секции в битах
    3. Авто-Bridge: Секция 4 бита = bridge, 8+ битов = verse
    4. Слияние: Соседние секции с одинаковым label объединяются
    
    Args:
        downbeats: массив времен сильных долей (единиц)
        beats: массив всех ударов
        audio_data: numpy array с аудио данными
        sample_rate: частота дискретизации
        bpm: BPM трека
        debug_data: словарь для сохранения debug информации (опционально)
        structure_section_starts: множество временных меток границ структуры от Essentia/Librosa (опционально)
        offset: время первого бита (сильной доли) в секундах (обязательно для квантования)
        duration: длительность трека в секундах (опционально, для корректной обработки последней секции)
    
    Returns:
        list: список секций с типом (verse/bridge), где каждый start - начало такта
    """
    if offset is None:
        print("[DEBUG] ERROR: offset is required for grid quantization", file=sys.stderr)
        return []
    
    if structure_section_starts is None:
        structure_section_starts = set()
    
    # Вычисляем длительность трека
    if duration is None:
        duration = len(audio_data) / sample_rate
    
    # Вычисляем интервал бита
    beat_interval = 60.0 / bpm
    
    print(f"[DEBUG] Grid formation: BPM={bpm}, offset={offset:.3f}s, duration={duration:.2f}s", file=sys.stderr)
    print(f"[DEBUG] Structure boundaries: {len(structure_section_starts)}", file=sys.stderr)
    
    # ШАГ 1: КВАНТОВАНИЕ ГРАНИЦ К БЛИЖАЙШЕМУ "РАЗ" С КОМПЕНСАЦИЕЙ ЗАДЕРЖКИ
    # Проблема: Essentia находит границы с задержкой (из-за размера окна анализа)
    # Решение: применяем динамический bias (сдвиг на 1 бит назад) перед округлением
    # Это компенсирует задержку и возвращает границы на их законное место в начале такта
    
    # Используем 1 бит (0.25 такта). Это "Золотая середина":
    # - Компенсирует лаг до 2.5 битов (стандартный лаг Essentia ~1-1.5 бита)
    # - Не ломает структуру, если детекция сработала чуть раньше (до -1 бита)
    bias = 1.0 * beat_interval
    
    print(f"[DEBUG] Quantization bias: {bias:.3f}s (1 beat = 0.25 bar)", file=sys.stderr)
    
    quantized_boundaries = []
    for boundary in structure_section_starts:
        # Применяем Bias, чтобы "помочь" округлению выбрать предыдущий такт при поздней детекции
        biased_boundary = boundary - bias
        
        # Квантуем смещенное время к ближайшему "Раз"
        n = round((biased_boundary - offset) / (4 * beat_interval))
        quantized_time = offset + (n * 4 * beat_interval)
        
        quantized_boundaries.append(quantized_time)
        
        # Логирование для отладки
        print(f"[DEBUG] Quantization: Raw={boundary:.3f}s -> Biased={biased_boundary:.3f}s -> Snapped={quantized_time:.3f}s", file=sys.stderr)
    
    # Сортируем и удаляем дубликаты
    quantized_boundaries = sorted(set(quantized_boundaries))
    # Убираем границы вне диапазона [0, duration]
    quantized_boundaries = [b for b in quantized_boundaries if 0 <= b <= duration]
    
    print(f"[DEBUG] Quantized boundaries: {len(quantized_boundaries)}", file=sys.stderr)
    
    # ШАГ 2: СОЗДАНИЕ СЕКЦИЙ ИЗ КВАНТОВАННЫХ ГРАНИЦ
    sections = []
    
    # Начинаем с начала трека
    current_start = offset  # Первая секция начинается с offset (первый "Раз")
    
    # Добавляем все границы, включая начало и конец
    all_boundaries = [current_start] + quantized_boundaries
    
    # Если последняя граница не совпадает с концом, добавляем конец
    if not all_boundaries or all_boundaries[-1] < duration - 0.1:
        all_boundaries.append(duration)
    
    # Создаем секции между границами
    for i in range(len(all_boundaries) - 1):
        section_start = all_boundaries[i]
        section_end = all_boundaries[i + 1]
        
        # Вычисляем длительность секции в битах
        section_duration_seconds = section_end - section_start
        section_beats = round(section_duration_seconds / beat_interval)
        
        # Округляем до кратности 4 (минимум 4 бита)
        section_beats = (section_beats // 4) * 4
        if section_beats < 4:
            section_beats = 4
        
        # Авто-Bridge: 4 бита = bridge, 8+ = verse
        if section_beats == 4:
            section_type = "bridge"
        else:
            section_type = "verse"
        
        sections.append({
            "type": section_type,
            "start": section_start,
            "beats": section_beats
        })
    
    # Если секций нет, создаем одну verse на весь трек
    if not sections:
        total_beats = round(duration * bpm / 60.0)
        # Округляем до кратности 4
        total_beats = (total_beats // 4) * 4
        if total_beats < 8:
            total_beats = 8
        sections.append({
            "type": "verse",
            "start": offset,
            "beats": total_beats
        })
    
    print(f"[DEBUG] Sections after creation: {len(sections)}", file=sys.stderr)
    
    # ШАГ 3: СЛИЯНИЕ СОСЕДНИХ СЕКЦИЙ С ОДИНАКОВЫМ LABEL
    merged_sections = []
    for section in sections:
        if not merged_sections:
            merged_sections.append(section.copy())
        else:
            prev_section = merged_sections[-1]
            # Если тип совпадает - объединяем
            if prev_section['type'] == section['type']:
                # Объединяем: увеличиваем beats предыдущей секции
                prev_section['beats'] += section['beats']
                print(f"[DEBUG] Merged {section['type']} sections: {prev_section['beats'] - section['beats']} + {section['beats']} = {prev_section['beats']} beats", file=sys.stderr)
            else:
                # Разные типы - добавляем как новую секцию
                merged_sections.append(section.copy())
    
    sections = merged_sections
    print(f"[DEBUG] Sections after merging: {len(sections)}", file=sys.stderr)
    
    # ШАГ 4: ФИНАЛЬНАЯ ПРОВЕРКА И КОРРЕКТИРОВКА
    # Убеждаемся, что все start квантованы к "Раз"
    beat_interval = 60.0 / bpm
    final_sections = []
    
    for i, section in enumerate(sections):
        # Квантуем start к ближайшему "Раз"
        quantized_start = offset + (round((section['start'] - offset) / (4 * beat_interval)) * (4 * beat_interval))
        
        # Пересчитываем длительность в битах на основе следующей секции или конца трека
        if i < len(sections) - 1:
            next_start = sections[i + 1]['start']
            next_quantized = offset + (round((next_start - offset) / (4 * beat_interval)) * (4 * beat_interval))
            section_end = next_quantized
        else:
            # Последняя секция - до конца трека (квантуем конец к ближайшему "Раз")
            section_end_quantized = offset + (round((duration - offset) / (4 * beat_interval)) * (4 * beat_interval))
            # Но не обрезаем трек - используем реальный duration
            section_end = duration
        
        # Вычисляем длительность в битах
        section_duration = section_end - quantized_start
        section_beats = round(section_duration / beat_interval)
        
        # Округляем до кратности 4
        section_beats = (section_beats // 4) * 4
        if section_beats < 4:
            section_beats = 4
        
        # Авто-Bridge: 4 бита = bridge, 8+ = verse
        if section_beats == 4:
            section_type = "bridge"
        else:
            section_type = "verse"
        
        final_sections.append({
            "type": section_type,
            "start": round(quantized_start, 3),
            "beats": section_beats
        })
    
    # Финальное слияние соседних секций с одинаковым типом
    final_merged = []
    for section in final_sections:
        if not final_merged:
            final_merged.append(section.copy())
        else:
            prev = final_merged[-1]
            if prev['type'] == section['type']:
                prev['beats'] += section['beats']
            else:
                final_merged.append(section.copy())
    
    print(f"[DEBUG] Final grid: {len(final_merged)} sections", file=sys.stderr)
    for i, section in enumerate(final_merged[:10]):
        print(f"[DEBUG]   Section #{i+1}: {section['start']:.3f}s, {section['type']}, {section['beats']} beats", file=sys.stderr)
    if len(final_merged) > 10:
        print(f"[DEBUG]   ... and {len(final_merged) - 10} more sections", file=sys.stderr)
    
    return final_merged


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
        
        # Step 4.5: Детекция провалов энергии (мостиков) с помощью EnergyDropDetector
        print("\n" + "=" * 80, file=sys.stderr)
        print("Step 4.5: Detecting energy drops (bridges) with EnergyDropDetector...", file=sys.stderr)
        print("=" * 80, file=sys.stderr)
        energy_drop_boundaries = []
        try:
            detector = EnergyDropDetector(
                audio_data=y,
                sample_rate=sr_orig,
                bpm=bpm,
                vocal_range=(300, 3000),
                drop_threshold=0.6,
                min_duration_beats=3.0,
                max_duration_beats=5.0
            )
            energy_drop_boundaries = detector.find_bridges()
            print(f"[Step 4.5] Energy drop detection complete. Found {len(energy_drop_boundaries)} bridge boundaries", file=sys.stderr)
            debug_data['energy_drop_boundaries'] = [float(b) for b in energy_drop_boundaries]
        except Exception as e:
            print(f"[Step 4.5] WARNING: Energy drop detection failed: {e}", file=sys.stderr)
            print(f"[Step 4.5] Continuing with Essentia analysis only...", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            energy_drop_boundaries = []
            debug_data['energy_drop_boundaries'] = []
        
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
        
        # Объединяем границы от Essentia и EnergyDropDetector
        print(f"[Step 5] Combining boundaries: {len(structure_boundaries)} from Essentia + {len(energy_drop_boundaries)} from EnergyDrop", file=sys.stderr)
        all_structure_boundaries = list(set(structure_boundaries + energy_drop_boundaries))
        all_structure_boundaries.sort()
        print(f"[Step 5] Total combined boundaries: {len(all_structure_boundaries)}", file=sys.stderr)
        structure_boundaries = all_structure_boundaries
        
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
        grid = detect_bridges(downbeats, all_beats, y, sr_orig, bpm, debug_data, merged_section_starts, offset, duration)
        
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
                'total_downbeats': len(downbeats)
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

