#!/usr/bin/env python3
"""
Анализирует аудио файл и определяет BPM и Offset
Использует librosa для анализа ритма и первого удара
"""

import librosa
import sys
import json

def analyze_track(audio_path, use_drums=False, drums_path=None):
    """
    Анализирует трек и определяет BPM и Offset
    
    Args:
        audio_path: путь к аудио файлу
        use_drums: использовать ли дорожку drums для анализа (более точно)
        drums_path: путь к дорожке drums (если use_drums=True)
    
    Returns:
        dict с ключами 'bpm' и 'offset'
    """
    try:
        # Если указана дорожка drums, используем её для более точного анализа
        if use_drums and drums_path:
            y, sr = librosa.load(drums_path)
            print(f"Analyzing drums track: {drums_path}", file=sys.stderr)
        else:
            y, sr = librosa.load(audio_path)
            print(f"Analyzing original track: {audio_path}", file=sys.stderr)
        
        # Определение BPM
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
        bpm = round(float(tempo[0]))
        print(f"Detected BPM: {bpm}", file=sys.stderr)
        
        # Определение Offset (первый downbeat)
        # Используем onset detection для нахождения первого сильного удара
        onset_frames = librosa.onset.onset_detect(
            y=y, 
            sr=sr, 
            units='time',
            backtrack=True,
            delta=0.3  # порог для определения onset
        )
        
        if len(onset_frames) > 0:
            offset = round(float(onset_frames[0]), 3)
            print(f"Detected offset: {offset}s", file=sys.stderr)
        else:
            # Если не нашли onset, используем первый beat
            if len(beats) > 0:
                beat_times = librosa.frames_to_time(beats, sr=sr)
                offset = round(float(beat_times[0]), 3)
                print(f"Using first beat as offset: {offset}s", file=sys.stderr)
            else:
                offset = 0.0
                print("Warning: Could not detect offset, using 0.0", file=sys.stderr)
        
        return {
            'bpm': bpm,
            'offset': offset
        }
    except Exception as e:
        print(f"Error analyzing track: {str(e)}", file=sys.stderr)
        # Возвращаем значения по умолчанию при ошибке
        return {
            'bpm': 120,
            'offset': 0.0
        }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Audio path required'}), file=sys.stderr)
        sys.exit(1)
    
    audio_path = sys.argv[1]
    use_drums = len(sys.argv) > 2 and sys.argv[2] == '--use-drums'
    drums_path = sys.argv[3] if use_drums and len(sys.argv) > 3 else None
    
    result = analyze_track(audio_path, use_drums=use_drums, drums_path=drums_path)
    print(json.dumps(result))

