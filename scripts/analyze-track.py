#!/usr/bin/env python3
"""
Умный анализ ритма с использованием Madmom и детекцией мостиков
Заменяет старый analyze-bpm-offset.py
"""

import sys
import json
import numpy as np
from scipy import signal
import librosa

try:
    from madmom.features.beats import RNNDownBeatProcessor, DBNBeatTrackingProcessor
    from madmom.audio.signal import SignalProcessor, FramedSignalProcessor
    from madmom.audio.stft import ShortTimeFourierTransformProcessor
    from madmom.audio.spectrogram import LogarithmicSpectrogramProcessor
    from madmom.features.onsets import OnsetPeakPickingProcessor
    MADMOM_AVAILABLE = True
except ImportError:
    MADMOM_AVAILABLE = False
    print("Warning: madmom not available, falling back to librosa", file=sys.stderr)


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


def detect_bridges(downbeats, beats, audio_data, sample_rate, bpm):
    """
    Детектирует мостики (bridges) в композиции по алгоритму "Mikhail's Logic"
    
    Args:
        downbeats: массив времен сильных долей (единиц)
        beats: массив всех ударов
        audio_data: numpy array с аудио данными
        sample_rate: частота дискретизации
        bpm: BPM трека
    
    Returns:
        list: список секций с типом (verse/bridge)
    """
    if len(downbeats) < 2:
        return []
    
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
    
    grid = []
    current_start = 0.0
    current_type = "verse"
    current_beats = 0
    
    # Проходим по всем сильным долям
    for i in range(len(downbeats) - 1):
        interval = intervals[i]
        downbeat_time = downbeats[i]
        next_downbeat_time = downbeats[i + 1]
        
        # Проверяем, является ли интервал "коротким"
        if interval < short_interval_threshold:
            # Это потенциальный мостик или брейк
            # Вычисляем RMS на этом участке
            segment_rms = calculate_rms(audio_data, sample_rate, downbeat_time, next_downbeat_time)
            
            # Если громкость "ровная" (не пик) - это мостик
            if segment_rms < break_threshold:
                # Завершаем предыдущую секцию
                if current_beats > 0:
                    grid.append({
                        "type": current_type,
                        "start": current_start,
                        "beats": current_beats
                    })
                
                # Начинаем мостик
                # Вычисляем количество битов в мостике (обычно 4)
                beats_in_bridge = int(round(interval / (60.0 / bpm)))
                grid.append({
                    "type": "bridge",
                    "start": downbeat_time,
                    "beats": beats_in_bridge
                })
                
                # Начинаем новую verse секцию после мостика
                current_start = next_downbeat_time
                current_type = "verse"
                current_beats = 0
            # Если это брейк (громкий участок), игнорируем и продолжаем verse
        else:
            # Обычный интервал - продолжаем verse
            if current_type == "verse" and current_beats == 0:
                current_start = downbeat_time
            
            # Вычисляем количество битов в этом интервале
            beats_in_interval = int(round(interval / (60.0 / bpm)))
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
    
    return grid


def analyze_track_with_madmom(audio_path):
    """
    Анализирует трек с использованием madmom
    
    Returns:
        dict с ключами 'bpm', 'offset', 'grid'
    """
    try:
        # Загружаем аудио
        y, sr = librosa.load(audio_path, sr=None)
        duration = len(y) / sr
        
        print(f"Analyzing track with madmom: {audio_path}", file=sys.stderr)
        print(f"Duration: {duration:.2f}s, Sample rate: {sr}Hz", file=sys.stderr)
        
        # Создаем процессоры для детекции downbeats
        downbeat_processor = RNNDownBeatProcessor()
        beat_processor = DBNBeatTrackingProcessor(fps=100)
        
        # Обрабатываем аудио
        act = downbeat_processor(audio_path)
        beats = beat_processor(act)
        
        # Извлекаем downbeats (сильные доли) и обычные beats
        # beats содержит пары (время, метка), где метка 1 = сильная доля, 2-4 = остальные
        downbeats = []
        all_beats = []
        
        for beat_time, beat_label in beats:
            all_beats.append(beat_time)
            if beat_label == 1:  # Сильная доля (единица)
                downbeats.append(beat_time)
        
        if len(downbeats) == 0:
            print("Warning: No downbeats detected, using all beats", file=sys.stderr)
            downbeats = all_beats[::4]  # Берем каждый 4-й удар как сильную долю
        
        if len(all_beats) == 0:
            raise ValueError("No beats detected")
        
        # Определяем BPM на основе интервалов между ударами
        if len(all_beats) > 1:
            beat_intervals = np.diff(all_beats)
            avg_interval = np.mean(beat_intervals)
            bpm = round(60.0 / avg_interval)
        else:
            bpm = 120  # Значение по умолчанию
        
        # Offset - время первого downbeat (сильной доли)
        offset = round(float(downbeats[0]) if len(downbeats) > 0 else all_beats[0], 3)
        
        print(f"Detected BPM: {bpm}", file=sys.stderr)
        print(f"Detected offset: {offset}s", file=sys.stderr)
        print(f"Found {len(downbeats)} downbeats, {len(all_beats)} total beats", file=sys.stderr)
        
        # Детектируем мостики
        grid = detect_bridges(downbeats, all_beats, y, sr, bpm)
        
        print(f"Detected {len([s for s in grid if s['type'] == 'bridge'])} bridge sections", file=sys.stderr)
        
        return {
            'bpm': bpm,
            'offset': offset,
            'grid': grid
        }
        
    except Exception as e:
        print(f"Error in madmom analysis: {str(e)}", file=sys.stderr)
        raise


def analyze_track_fallback(audio_path):
    """
    Fallback анализ с использованием librosa (если madmom недоступен)
    
    Returns:
        dict с ключами 'bpm', 'offset', 'grid'
    """
    try:
        y, sr = librosa.load(audio_path)
        duration = len(y) / sr
        
        print(f"Analyzing track with librosa (fallback): {audio_path}", file=sys.stderr)
        
        # Определение BPM
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
        bpm = round(float(tempo[0]))
        
        # Определение Offset
        onset_frames = librosa.onset.onset_detect(
            y=y, 
            sr=sr, 
            units='time',
            backtrack=True,
            delta=0.3
        )
        
        if len(onset_frames) > 0:
            offset = round(float(onset_frames[0]), 3)
        else:
            if len(beats) > 0:
                beat_times = librosa.frames_to_time(beats, sr=sr)
                offset = round(float(beat_times[0]), 3)
            else:
                offset = 0.0
        
        # Простой grid без детекции мостиков (fallback)
        total_beats = int(round(duration * bpm / 60.0))
        grid = [{
            "type": "verse",
            "start": 0.0,
            "beats": total_beats
        }]
        
        return {
            'bpm': bpm,
            'offset': offset,
            'grid': grid
        }
        
    except Exception as e:
        print(f"Error in fallback analysis: {str(e)}", file=sys.stderr)
        raise


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Audio path required'}), file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    
    try:
        if MADMOM_AVAILABLE:
            result = analyze_track_with_madmom(audio_path)
        else:
            print("Warning: madmom not available, using librosa fallback", file=sys.stderr)
            result = analyze_track_fallback(audio_path)
        
        print(json.dumps(result))
        
    except Exception as e:
        print(json.dumps({
            'error': str(e),
            'bpm': 120,
            'offset': 0.0,
            'grid': [{
                'type': 'verse',
                'start': 0.0,
                'beats': 100
            }]
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()

