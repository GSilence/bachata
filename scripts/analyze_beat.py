#!/usr/bin/env python3
"""
Анализ ритма бачаты с использованием Madmom для определения сильных долей (downbeats)
Генерирует массив beats с номерами 1-8 для фронтенда

Использует:
- madmom.features.beats.RNNDownBeatProcessor для определения сильных долей
"""

# ВАЖНО: Патчи должны применяться ДО ВСЕХ импортов, включая numpy!
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

# Импорт madmom (обязателен)
try:
    from madmom.features import RNNDownBeatProcessor, DBNBeatTrackingProcessor
    import librosa  # Используется только для загрузки аудио
except ImportError as e:
    print(f"Error: madmom is required but not available: {e}", file=sys.stderr)
    sys.exit(1)


def generate_beats_from_downbeats(downbeats, all_beats, bpm, duration):
    """
    Генерирует массив beats с номерами 1-8 на основе downbeats и всех beats
    
    Args:
        downbeats: массив времен сильных долей (единиц)
        all_beats: массив всех ударов
        bpm: темп трека
        duration: длительность трека в секундах
    
    Returns:
        list: массив объектов { time: float, number: int (1-8) }
    """
    beats = []
    
    if len(all_beats) == 0:
        return beats
    
    # Если нет downbeats, используем каждый 4-й удар как сильную долю
    if len(downbeats) == 0:
        downbeats = all_beats[::4] if len(all_beats) >= 4 else [all_beats[0]]
    
    # Сортируем beats по времени
    all_beats = sorted(all_beats)
    downbeats = sorted(downbeats)
    
    # Вычисляем средний интервал между битами для приблизительного сравнения
    if len(all_beats) > 1:
        beat_interval = np.mean(np.diff(all_beats))
        tolerance = beat_interval * 0.1  # 10% от интервала как допуск
    else:
        beat_interval = 60.0 / bpm
        tolerance = 0.01  # 10ms по умолчанию
    
    # Проходим по всем beats и присваиваем номера
    beat_number = 1
    downbeat_idx = 0
    
    for beat_time in all_beats:
        # Проверяем, является ли этот beat downbeat (сильной долей)
        # Используем приблизительное сравнение из-за точности float
        is_downbeat = False
        while downbeat_idx < len(downbeats):
            downbeat_time = downbeats[downbeat_idx]
            if abs(beat_time - downbeat_time) <= tolerance:
                is_downbeat = True
                downbeat_idx += 1
                break
            elif downbeat_time > beat_time:
                break
            else:
                downbeat_idx += 1
        
        # Если это downbeat (сильная доля), сбрасываем счетчик на "1"
        if is_downbeat:
            beat_number = 1
        
        beats.append({
            "time": round(beat_time, 3),
            "number": beat_number
        })
        
        # Переходим к следующему номеру (1-8 цикл)
        beat_number = (beat_number % 8) + 1
    
    # Если последний beat не доходит до конца трека, дополняем до конца
    if len(beats) > 0:
        last_beat_time = beats[-1]["time"]
        if last_beat_time < duration:
            # Вычисляем средний интервал между битами
            if len(all_beats) > 1:
                beat_interval = np.mean(np.diff(all_beats))
            else:
                beat_interval = 60.0 / bpm
            
            current_time = last_beat_time + beat_interval
            while current_time <= duration:
                beats.append({
                    "time": round(current_time, 3),
                    "number": beat_number
                })
                current_time += beat_interval
                beat_number = (beat_number % 8) + 1
    
    return beats


def analyze_with_madmom(audio_path):
    """
    Анализирует трек с использованием madmom для определения downbeats
    
    Returns:
        dict с ключами 'bpm', 'offset', 'beats'
    """
    try:
        # Загружаем аудио через librosa в моно (mono=True по умолчанию)
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = len(y) / sr
        
        print(f"Analyzing track with madmom: {audio_path}", file=sys.stderr)
        print(f"Duration: {duration:.2f}s, Sample rate: {sr}Hz", file=sys.stderr)
        print(f"Audio shape: {y.shape}, Channels: {'mono' if y.ndim == 1 else 'stereo'}", file=sys.stderr)
        
        # Убеждаемся, что аудио в моно (1D массив)
        if y.ndim > 1:
            # Если все еще стерео, конвертируем в моно
            y = np.mean(y, axis=0)
            print("Converted stereo to mono", file=sys.stderr)
        
        # Madmom процессоры ожидают путь к файлу, но могут загрузить стерео
        # Создаем временный моно файл для madmom
        import tempfile
        import soundfile as sf
        
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        
        # Сохраняем моно аудио во временный файл
        sf.write(tmp_path, y, sr)
        print(f"Created temporary mono file: {tmp_path}", file=sys.stderr)
        
        try:
            # Создаем процессоры для детекции downbeats и beats
            downbeat_processor = RNNDownBeatProcessor()
            beat_processor = DBNBeatTrackingProcessor(fps=100)
            
            # Обрабатываем аудио через временный моно файл
            act = downbeat_processor(tmp_path)
            beats_result = beat_processor(act)
        finally:
            # Удаляем временный файл
            try:
                os.unlink(tmp_path)
            except:
                pass
        
        # Извлекаем downbeats (сильные доли) и обычные beats
        # beats_result содержит пары (время, метка), где метка 1 = сильная доля, 2-4 = остальные
        downbeats = []
        all_beats = []
        
        for beat_time, beat_label in beats_result:
            all_beats.append(float(beat_time))
            if beat_label == 1:  # Сильная доля (единица)
                downbeats.append(float(beat_time))
        
        if len(all_beats) == 0:
            raise ValueError("No beats detected by madmom")
        
        # Определяем BPM на основе интервалов между ударами
        if len(all_beats) > 1:
            beat_intervals = np.diff(all_beats)
            avg_interval = np.mean(beat_intervals)
            bpm = round(60.0 / avg_interval)
        else:
            bpm = 120  # Значение по умолчанию
        
        # Если нет downbeats, используем каждый 4-й удар как сильную долю
        if len(downbeats) == 0:
            print("Warning: No downbeats detected, using every 4th beat as downbeat", file=sys.stderr)
            downbeats = all_beats[::4] if len(all_beats) >= 4 else [all_beats[0]]
        
        # Offset - время первого downbeat (сильной доли)
        offset = round(float(downbeats[0]), 3)
        
        print(f"Detected BPM: {bpm}", file=sys.stderr)
        print(f"Detected offset: {offset}s", file=sys.stderr)
        print(f"Found {len(downbeats)} downbeats, {len(all_beats)} total beats", file=sys.stderr)
        
        # Генерируем массив beats с номерами 1-8
        beats = generate_beats_from_downbeats(downbeats, all_beats, bpm, duration)
        
        print(f"Generated {len(beats)} beats for frontend", file=sys.stderr)
        
        return {
            'bpm': float(bpm),
            'offset': float(offset),
            'beats': beats
        }
        
    except Exception as e:
        print(f"Error in madmom analysis: {str(e)}", file=sys.stderr)
        raise




def main():
    if len(sys.argv) < 2:
        error_result = {
            'error': 'Audio path required',
            'bpm': 120.0,
            'offset': 0.0,
            'beats': []
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    
    try:
        result = analyze_with_madmom(audio_path)
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            'error': str(e),
            'bpm': 120.0,
            'offset': 0.0,
            'beats': []
        }
        print(json.dumps(error_result), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

