#!/usr/bin/env python3
"""
Анализ жанра/стиля музыки для Bachata Beat Counter v2.0
Определяет подходит ли трек для приложения (Bachata или нет).

Улучшения v2:
- Расширенный диапазон BPM: 90-170 (все стили бачаты)
- Детекция Sensual/Urban/Classic Bachata
- Анализ середины трека (не только начала)
- Детекция длинного intro
"""

import sys
import json
import numpy as np
import librosa
from scipy import signal


# ==========================================
# ПАТТЕРНЫ ДЛЯ BACHATA
# ==========================================

BACHATA_PATTERNS = {
    # Classic Bachata (традиционная)
    'classic': {
        'tempo': (115, 145),
        'bass_min': 0.35,
        'mids_min': 0.20,
        'flatness_max': 0.25,
        'rhythm_regularity_min': 0.70,
        'harm_perc_ratio': (0.8, 2.0),
        'centroid_norm': (0.35, 0.70)
    },
    # Sensual Bachata (медленная, синтезаторы, длинное intro)
    'sensual': {
        'tempo': (90, 125),
        'bass_min': 0.15,  # Может быть слабее
        'mids_min': 0.15,
        'flatness_max': 0.50,  # Разрешаем синтезаторы
        'rhythm_regularity_min': 0.60,
        'harm_perc_ratio': (0.5, 2.5),
        'centroid_norm': (0.25, 0.65),
        'allow_long_intro': True
    },
    # Urban Bachata (с hip-hop элементами, вариативный темп)
    'urban': {
        'tempo': (100, 170),
        'bass_min': 0.40,  # Сильный бас
        'mids_min': 0.15,
        'flatness_max': 0.40,
        'rhythm_regularity_min': 0.65,
        'harm_perc_ratio': (0.6, 2.5),
        'centroid_norm': (0.30, 0.75)
    },
    # Общие параметры
    'general': {
        'tempo_range': (90, 170),  # Весь диапазон
        'tempo_stability_max_variance': 8,  # Увеличили для вариативности
    }
}


# ==========================================
# HELPER FUNCTIONS
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


def estimate_intro_duration(y, sr, max_check_duration=60):
    """
    Оценка длины intro по нарастанию энергии
    Intro обычно = низкая энергия, постепенное нарастание
    """
    duration = min(len(y) / sr, max_check_duration)
    
    # Разбиваем на 2-секундные чанки
    chunk_duration = 2.0
    n_chunks = int(duration / chunk_duration)
    
    if n_chunks < 3:
        return 0  # Трек слишком короткий
    
    energies = []
    for i in range(n_chunks):
        start_sample = int(i * chunk_duration * sr)
        end_sample = int((i + 1) * chunk_duration * sr)
        chunk = y[start_sample:end_sample]
        energies.append(get_rms(chunk))
    
    # Нормализуем
    max_energy = max(energies) if max(energies) > 0 else 1.0
    energies_norm = [e / max_energy for e in energies]
    
    # Ищем момент когда энергия достигает 60% от максимума
    intro_chunks = 0
    for i, energy in enumerate(energies_norm):
        if energy >= 0.6:
            intro_chunks = i
            break
        intro_chunks = i + 1
    
    intro_duration = intro_chunks * chunk_duration
    
    # Если энергия нарастает плавно на протяжении >15 сек = длинное intro
    if intro_duration > 15:
        print(f"[Intro] Detected long intro: {intro_duration:.1f}s", file=sys.stderr)
    
    return intro_duration


# ==========================================
# FEATURE EXTRACTION
# ==========================================

def extract_genre_features(y, sr, analyze_full=False):
    """
    Извлечение аудио-фичей для анализа жанра
    
    analyze_full: если False, анализирует середину трека (30-90s)
                  если True, анализирует весь трек
    """
    duration = len(y) / sr
    
    # УЛУЧШЕНИЕ: Анализируем середину трека, а не только начало!
    if not analyze_full and duration > 60:
        # Берём середину: 30-90 секунд (или 20%-70% трека)
        start_time = max(20, duration * 0.2)
        end_time = min(90, duration * 0.7)
        
        start_sample = int(start_time * sr)
        end_sample = int(end_time * sr)
        
        y_analysis = y[start_sample:end_sample]
        print(f"[Analysis] Using middle section: {start_time:.1f}s - {end_time:.1f}s", file=sys.stderr)
    else:
        y_analysis = y
        print(f"[Analysis] Using full track: {duration:.1f}s", file=sys.stderr)
    
    features = {}

    # 1. ТЕМП
    tempo, beat_frames = librosa.beat.beat_track(y=y_analysis, sr=sr)
    bpm = float(np.atleast_1d(tempo)[0])
    features['bpm'] = bpm

    # Стабильность темпа
    if len(beat_frames) > 1:
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        intervals = np.diff(beat_times)
        if len(intervals) > 0:
            local_bpms = 60.0 / intervals
            features['bpm_variance'] = float(np.std(local_bpms))
        else:
            features['bpm_variance'] = 0.0
    else:
        features['bpm_variance'] = 0.0

    # 2. ЧАСТОТНЫЕ ДИАПАЗОНЫ
    analysis_duration = len(y_analysis) / sr
    sample_times = np.linspace(0.5, analysis_duration - 0.5, min(20, int(analysis_duration)))

    bass_energies = []
    mid_energies = []
    high_energies = []

    for t in sample_times:
        bass_energies.append(get_band_energy(y_analysis, sr, t, (None, 200)))
        mid_energies.append(get_band_energy(y_analysis, sr, t, (200, 4000)))
        high_energies.append(get_band_energy(y_analysis, sr, t, (4000, None)))

    bass_energy = np.mean(bass_energies)
    mid_energy = np.mean(mid_energies)
    high_energy = np.mean(high_energies)

    total = bass_energy + mid_energy + high_energy
    if total > 0:
        features['norm_bass'] = float(bass_energy / total)
        features['norm_mids'] = float(mid_energy / total)
        features['norm_highs'] = float(high_energy / total)
    else:
        features['norm_bass'] = 0.0
        features['norm_mids'] = 0.0
        features['norm_highs'] = 0.0

    # 3. СПЕКТРАЛЬНЫЕ ХАРАКТЕРИСТИКИ
    centroid = librosa.feature.spectral_centroid(y=y_analysis, sr=sr)
    features['spectral_centroid'] = float(np.mean(centroid))
    features['centroid_norm'] = min(features['spectral_centroid'] / 8000, 1.0)

    flatness = librosa.feature.spectral_flatness(y=y_analysis)
    features['spectral_flatness'] = float(np.mean(flatness))

    rolloff = librosa.feature.spectral_rolloff(y=y_analysis, sr=sr, roll_percent=0.85)
    features['spectral_rolloff'] = float(np.mean(rolloff))
    features['rolloff_norm'] = min(features['spectral_rolloff'] / 10000, 1.0)

    # 4. РИТМ
    onset_env = librosa.onset.onset_strength(y=y_analysis, sr=sr)
    features['onset_strength'] = float(np.mean(onset_env))

    onset_peaks = librosa.util.peak_pick(onset_env, pre_max=3, post_max=3, pre_avg=3, post_avg=5, delta=0.5, wait=10)
    if len(onset_peaks) > 2:
        onset_regularity = 1.0 / (1.0 + np.std(np.diff(onset_peaks)))
        features['rhythm_regularity'] = float(onset_regularity)
    else:
        features['rhythm_regularity'] = 0.0

    # 5. HPSS (Harmonic-Percussive Source Separation)
    y_harm, y_perc = librosa.effects.hpss(y_analysis, margin=1.0)
    harm_energy = np.sqrt(np.mean(y_harm**2))
    perc_energy = np.sqrt(np.mean(y_perc**2))

    features['harmonic_energy'] = float(harm_energy)
    features['percussive_energy'] = float(perc_energy)

    if perc_energy > 0:
        features['harm_perc_ratio'] = float(harm_energy / perc_energy)
    else:
        features['harm_perc_ratio'] = 0.0

    # 6. ДЕТЕКЦИЯ INTRO (на полном треке)
    intro_duration = estimate_intro_duration(y, sr)
    features['intro_duration'] = intro_duration
    features['has_long_intro'] = intro_duration > 15

    return features


# ==========================================
# COMPATIBILITY CHECK
# ==========================================

def check_bachata_variant(features, variant_name):
    """
    Проверка соответствия конкретному варианту бачаты
    """
    pattern = BACHATA_PATTERNS[variant_name]
    checks = {}
    
    # 1. Темп
    checks['tempo'] = pattern['tempo'][0] <= features['bpm'] <= pattern['tempo'][1]
    
    # 2. Стабильность темпа
    checks['tempo_stable'] = features['bpm_variance'] < BACHATA_PATTERNS['general']['tempo_stability_max_variance']
    
    # 3. Бас
    checks['bass'] = features['norm_bass'] >= pattern['bass_min']
    
    # 4. Средние частоты
    checks['mids'] = features['norm_mids'] >= pattern['mids_min']
    
    # 5. Спектральный баланс
    checks['spectral_balance'] = (
        pattern['centroid_norm'][0] <= features['centroid_norm'] <= pattern['centroid_norm'][1]
    )
    
    # 6. Flatness (не слишком шумно)
    checks['not_too_noisy'] = features['spectral_flatness'] <= pattern['flatness_max']
    
    # 7. Регулярность ритма
    checks['rhythm_regular'] = features['rhythm_regularity'] >= pattern['rhythm_regularity_min']
    
    # 8. Harm/Perc баланс
    checks['balanced_mix'] = (
        pattern['harm_perc_ratio'][0] <= features['harm_perc_ratio'] <= pattern['harm_perc_ratio'][1]
    )
    
    # Для Sensual: длинное intro допустимо
    if variant_name == 'sensual' and features.get('has_long_intro', False):
        checks['long_intro_ok'] = True
    
    passed = sum(checks.values())
    total = len(checks)
    
    return {
        'variant': variant_name,
        'checks': checks,
        'passed': passed,
        'total': total,
        'score': passed / total,
        'compatible': passed >= (total * 0.65)  # 65% проверок должны пройти
    }


def check_all_bachata_variants(features):
    """
    Проверка всех вариантов бачаты
    Возвращает лучший match
    """
    results = {}
    
    for variant in ['classic', 'sensual', 'urban']:
        result = check_bachata_variant(features, variant)
        results[variant] = result
    
    # Находим лучший match
    best_variant = max(results.items(), key=lambda x: x[1]['score'])
    
    # Если хотя бы один вариант подходит
    any_compatible = any(r['compatible'] for r in results.values())
    
    return {
        'best_variant': best_variant[0],
        'best_score': best_variant[1]['score'],
        'best_checks': best_variant[1],
        'all_results': results,
        'is_bachata': any_compatible
    }


# ==========================================
# GENRE HINT
# ==========================================

def guess_genre_hint(features, bachata_result):
    """Попытка угадать жанр"""
    
    # Если это бахата
    if bachata_result['is_bachata']:
        best_variant = bachata_result['best_variant']
        
        if bachata_result['best_score'] >= 0.85:
            # Очень уверены
            return f'bachata_{best_variant}'
        elif bachata_result['best_score'] >= 0.70:
            # Довольно уверены
            return 'bachata'
        else:
            # Похоже на латину
            return 'latin'
    
    # Не бахата - пытаемся определить что это
    bpm = features['bpm']
    flatness = features['spectral_flatness']
    centroid = features['spectral_centroid']
    onset = features['onset_strength']
    
    # EDM / Electronic
    if bpm >= 120 and flatness > 0.5:
        if bpm >= 140:
            return 'edm'
        return 'electronic'
    
    # Rock
    if 100 <= bpm <= 150:
        if centroid > 3000 and onset > 0.4:
            return 'rock'
    
    # Reggaeton (часто путают с Urban Bachata)
    if 85 <= bpm <= 105:
        if features['norm_bass'] > 0.50:
            return 'reggaeton'
    
    # Salsa / Merengue (тоже латиноамериканские)
    if 140 <= bpm <= 200:
        if features['rhythm_regularity'] > 0.65:
            return 'salsa_or_merengue'
    
    # Pop (catch-all)
    if 90 <= bpm <= 135:
        return 'pop'
    
    # Ballad
    if bpm < 90:
        if flatness < 0.3:
            return 'ballad'
    
    return 'unknown'


# ==========================================
# MAIN
# ==========================================

def analyze_genre(audio_path):
    """Главная функция анализа жанра"""
    print(f"[Genre Analysis v2.0] Loading: {audio_path}", file=sys.stderr)
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = len(y) / sr
    print(f"[Audio] Duration: {duration:.1f}s @ {sr}Hz", file=sys.stderr)

    print("[Features] Extracting features from middle section...", file=sys.stderr)
    features = extract_genre_features(y, sr, analyze_full=False)

    print("[Compatibility] Checking all Bachata variants...", file=sys.stderr)
    bachata_result = check_all_bachata_variants(features)

    print(f"[Result] Best variant: {bachata_result['best_variant']} (score: {bachata_result['best_score']:.0%})", file=sys.stderr)

    genre_hint = guess_genre_hint(features, bachata_result)
    
    # Основная уверенность = score лучшего варианта
    confidence = bachata_result['best_score']

    print(f"[Genre] Detected: {genre_hint} (confidence: {confidence:.0%})", file=sys.stderr)

    return {
        'is_bachata_compatible': bachata_result['is_bachata'],
        'confidence': round(confidence, 3),
        'genre_hint': genre_hint,
        'best_bachata_variant': bachata_result['best_variant'],
        'variant_score': round(bachata_result['best_score'], 3),
        'checks_passed': bachata_result['best_checks']['passed'],
        'total_checks': bachata_result['best_checks']['total'],
        'details': bachata_result['best_checks']['checks'],
        'all_variants': {
            k: {
                'score': round(v['score'], 3),
                'compatible': v['compatible'],
                'passed': v['passed'],
                'total': v['total']
            }
            for k, v in bachata_result['all_results'].items()
        },
        'features': {k: round(v, 4) if isinstance(v, float) else v for k, v in features.items()}
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Audio path required'}))
        sys.exit(1)

    audio_path = sys.argv[1]

    try:
        result = analyze_genre(audio_path)
        print(json.dumps(result, indent=2))
    except Exception as e:
        import traceback
        print(f"[Error] {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({'error': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()