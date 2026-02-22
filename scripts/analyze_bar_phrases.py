#!/usr/bin/env python3
"""
analyze_bar_phrases.py
======================
Экспериментальный анализ музыкальных квадратов через madmom RNNBarProcessor.

Идея: RNNBarProcessor нейросетью находит 4-битовые бары точнее, чем
наша побитовая сумма энергий. Используем его позиции баров как основу
для сравнения энергии пар баров → определяем фазу квадрата (РАЗ или ПЯТЬ).

Запуск:
  python analyze_bar_phrases.py <audio_file> [v2_json_file]

Вывод: JSON в stdout (для API-интеграции)
"""

import sys
import json
import os
import math
import warnings
warnings.filterwarnings('ignore')

# ── Compatibility patches для madmom на Python 3.10+ / numpy 1.24+ ──
import collections
import collections.abc
for _name in ('MutableSequence','Callable','Mapping','MutableMapping',
              'Sequence','MutableSet','Set','Iterable','Iterator'):
    if not hasattr(collections, _name):
        setattr(collections, _name, getattr(collections.abc, _name))

import numpy as np
for _alias in ('float','int','complex','bool','object','str'):
    if not hasattr(np, _alias):
        setattr(np, _alias, __builtins__[_alias] if isinstance(__builtins__, dict) else getattr(__builtins__, _alias, eval(_alias)))

# ────────────────────────────────────────────────────────────────────

def log(msg):
    print(msg, file=sys.stderr)

def load_audio_librosa(audio_path, sr=44100):
    import librosa
    y, sr = librosa.load(audio_path, sr=sr, mono=True)
    return y, sr

def get_beats_madmom(audio_path):
    """Получаем биты через madmom (как в основном анализе)."""
    from madmom.features.beats import RNNBeatProcessor, DBNBeatTrackingProcessor
    beat_proc = RNNBeatProcessor()
    beat_act = beat_proc(audio_path)
    dbn = DBNBeatTrackingProcessor(fps=100)
    beats = dbn(beat_act)
    return beats  # np.array of beat times in seconds

def get_bar_activations(audio_path, beats):
    """RNNBarProcessor: для каждого бита возвращает вероятность быть началом бара."""
    from madmom.features.downbeats import RNNBarProcessor
    import madmom.audio.signal as ms
    sig = ms.Signal(audio_path, sample_rate=44100, num_channels=1)
    bar_proc = RNNBarProcessor()
    bar_act = bar_proc((sig, beats))
    # bar_act shape: (N_beats, 2) — col0=time, col1=bar_start_probability
    return bar_act

def get_bar_starts(bar_act, threshold=0.5):
    """Извлекаем позиции начала баров по порогу вероятности."""
    times = bar_act[:, 0]
    probs = bar_act[:, 1]
    mask = probs > threshold
    return times[mask], probs[mask]

def compute_bar_energy(y, sr, bar_times, window_sec=None):
    """
    Вычисляем RMS-энергию для каждого бара.
    Окно: от начала бара до начала следующего (или window_sec если задано).
    """
    energies = []
    for i, t_start in enumerate(bar_times):
        t_end = bar_times[i + 1] if i + 1 < len(bar_times) else t_start + (bar_times[-1] - bar_times[0]) / max(len(bar_times) - 1, 1)
        if window_sec:
            t_end = min(t_start + window_sec, len(y) / sr)
        s = int(t_start * sr)
        e = int(t_end * sr)
        chunk = y[s:e]
        if len(chunk) == 0:
            energies.append(0.0)
        else:
            energies.append(float(np.sqrt(np.mean(chunk ** 2))))
    return energies

def find_song_start_bar(bar_times, bar_energies, threshold_ratio=0.4):
    """
    Ищем первый бар, где музыка реально началась.
    Критерий: энергия >= threshold_ratio * max_energy в первых 30 барах.
    """
    max_e = max(bar_energies[:30]) if len(bar_energies) >= 30 else max(bar_energies)
    min_e = max_e * threshold_ratio
    for i, e in enumerate(bar_energies):
        if e >= min_e:
            return i
    return 0

def determine_phase(bar_energies, start_bar_idx, n_pairs=8):
    """
    Определяем фазу квадрата: какой бар является РАЗ.

    Сравниваем два варианта паровки:
      Phase A: квадраты = (bar[0], bar[1]), (bar[2], bar[3]), ...
               → bar[start], bar[start+2], bar[start+4]... = РАЗ
      Phase B: квадраты = (bar[1], bar[2]), (bar[3], bar[4]), ...
               → bar[start+1], bar[start+3], bar[start+5]... = РАЗ

    В бачате РАЗ = первый и сильнейший бар квадрата.
    Выбираем фазу, где "нечётные" бары суммарно громче.
    """
    # Берём n_pairs пар от start_bar_idx
    a_sums = []  # phase A: бары start, start+2, start+4...
    b_sums = []  # phase B: бары start+1, start+3, start+5...

    for p in range(n_pairs):
        ia = start_bar_idx + p * 2
        ib = start_bar_idx + p * 2 + 1
        if ia < len(bar_energies):
            a_sums.append(bar_energies[ia])
        if ib < len(bar_energies):
            b_sums.append(bar_energies[ib])

    sum_a = sum(a_sums)
    sum_b = sum(b_sums)

    log(f"[Phase] Phase A (bars {start_bar_idx},{start_bar_idx+2},...): sum={sum_a:.4f}")
    log(f"[Phase] Phase B (bars {start_bar_idx+1},{start_bar_idx+3},...): sum={sum_b:.4f}")

    # trim: первые 4 пары для дополнительной проверки
    trim = 4
    sum_a_t = sum(a_sums[:trim])
    sum_b_t = sum(b_sums[:trim])
    log(f"[Phase] Trim({trim}): A={sum_a_t:.4f}, B={sum_b_t:.4f}")

    if sum_a >= sum_b:
        phase = 'A'
        raz_offset = 0  # РАЗ = первый бар пары
    else:
        phase = 'B'
        raz_offset = 1  # РАЗ = второй бар (сдвиг на 1 бар)

    log(f"[Phase] Winner: Phase {phase} → raz_offset={raz_offset}")
    return phase, raz_offset, sum_a, sum_b

def build_squares(bar_times, bar_energies, start_bar_idx, raz_offset):
    """
    Строим список квадратов (8 битов = 2 бара).
    raz_offset=0: квадрат начинается с бара start_bar_idx
    raz_offset=1: квадрат начинается с бара start_bar_idx+1
    """
    squares = []
    sq_start_idx = start_bar_idx + raz_offset
    i = sq_start_idx
    sq_num = 1
    while i + 1 < len(bar_times):
        sq = {
            'square': sq_num,
            'bar1_idx': i,
            'bar2_idx': i + 1,
            'time_start': round(float(bar_times[i]), 3),
            'time_end': round(float(bar_times[i + 2]) if i + 2 < len(bar_times) else float(bar_times[i + 1]) + (bar_times[i + 1] - bar_times[i]), 3),
            'bar1_energy': round(float(bar_energies[i]), 5),
            'bar2_energy': round(float(bar_energies[i + 1]), 5),
            'dominant': 'bar1' if bar_energies[i] >= bar_energies[i + 1] else 'bar2',
        }
        squares.append(sq)
        i += 2
        sq_num += 1
    return squares

def compare_with_v2(v2_json_path, bar_squares):
    """
    Сравниваем наши квадраты с результатом v2-анализа.
    Возвращаем разницу в фазе (если есть).
    """
    if not v2_json_path or not os.path.exists(v2_json_path):
        return None
    with open(v2_json_path) as f:
        v2 = json.load(f)

    v2_start = v2.get('song_start_time', None)
    v2_swapped = v2.get('row_swapped', False)
    bar_start = bar_squares[0]['time_start'] if bar_squares else None

    diff = None
    if v2_start is not None and bar_start is not None:
        diff = round(abs(v2_start - bar_start), 3)

    return {
        'v2_song_start_time': v2_start,
        'v2_row_swapped': v2_swapped,
        'bar_phrase_start': bar_start,
        'start_diff_sec': diff,
        'match': diff is not None and diff < 0.5,
    }

def analyze(audio_path, v2_json_path=None):
    log(f"[Bar phrases] Audio: {audio_path}")

    log("[1] Beat tracking (madmom)...")
    beats = get_beats_madmom(audio_path)
    log(f"    {len(beats)} beats found, BPM≈{60 / float(np.median(np.diff(beats))):.1f}")

    log("[2] Bar activations (RNNBarProcessor)...")
    bar_act = get_bar_activations(audio_path, beats)

    bar_times, bar_probs = get_bar_starts(bar_act, threshold=0.5)
    log(f"    {len(bar_times)} bars found")

    log("[3] Loading audio for energy computation...")
    y, sr = load_audio_librosa(audio_path)

    log("[4] Computing bar energies...")
    bar_energies = compute_bar_energy(y, sr, bar_times)

    log("[5] Finding song start bar...")
    start_bar_idx = find_song_start_bar(bar_times, bar_energies)
    log(f"    Song starts at bar {start_bar_idx} ({bar_times[start_bar_idx]:.3f}s)")

    log("[6] Determining РАЗ phase...")
    phase, raz_offset, sum_a, sum_b = determine_phase(bar_energies, start_bar_idx)

    log("[7] Building squares...")
    squares = build_squares(bar_times, bar_energies, start_bar_idx, raz_offset)

    log("[8] Comparing with v2 analysis...")
    comparison = compare_with_v2(v2_json_path, squares)

    # Полный список баров для отладки
    bars_debug = [
        {
            'bar_idx': i,
            'time': round(float(bar_times[i]), 3),
            'prob': round(float(bar_probs[i]), 4),
            'energy': round(float(bar_energies[i]), 5),
        }
        for i in range(len(bar_times))
    ]

    bpm_approx = round(60 / float(np.median(np.diff(beats))), 1)

    # per_beat_bars: для каждого бита из madmom — его bar_prob и к какому бару он принадлежит
    # bar_act: shape (N_beats, 2) — col0=time, col1=prob
    per_beat_bars = []
    bar_times_list = list(bar_times)
    for i, beat_t in enumerate(beats):
        prob = float(bar_act[i, 1]) if i < len(bar_act) else 0.0
        if math.isnan(prob) or math.isinf(prob):
            prob = 0.0
        # ищем бар, к которому принадлежит этот бит (ближайший bar_start <= beat_time)
        belonging_bar = -1
        for bi, bt in enumerate(bar_times_list):
            if bt <= beat_t + 0.05:
                belonging_bar = bi
            else:
                break
        per_beat_bars.append({
            'beat_idx': i + 1,
            'time': round(float(beat_t), 3),
            'bar_prob': round(prob, 5),
            'bar_idx': belonging_bar,
            'is_bar_start': prob > 0.5,
        })

    result = {
        'success': True,
        'audio_path': audio_path,
        'bpm': bpm_approx,
        'total_beats': int(len(beats)),
        'total_bars': int(len(bar_times)),
        'song_start_bar_idx': int(start_bar_idx),
        'song_start_time': round(float(bar_times[start_bar_idx]), 3),
        'phase': phase,
        'raz_offset': int(raz_offset),
        'row_swapped': raz_offset == 1,
        'phase_sum_A': round(sum_a, 5),
        'phase_sum_B': round(sum_b, 5),
        'squares': squares[:40],
        'bars': bars_debug[:120],
        'per_beat_bars': per_beat_bars,
        'v2_comparison': comparison,
    }
    return result

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: analyze_bar_phrases.py <audio> [v2_json]'}))
        sys.exit(1)

    audio_path = sys.argv[1]
    v2_json_path = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.exists(audio_path):
        print(json.dumps({'success': False, 'error': f'Audio file not found: {audio_path}'}))
        sys.exit(1)

    try:
        result = analyze(audio_path, v2_json_path)
        # NaN/Inf не являются валидным JSON — заменяем на null через re
        import re
        raw = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=True)
        raw = re.sub(r'\bNaN\b', 'null', raw)
        raw = re.sub(r'\bInfinity\b', 'null', raw)
        raw = re.sub(r'\b-Infinity\b', 'null', raw)
        print(raw)
    except Exception as e:
        import traceback
        print(json.dumps({'success': False, 'error': str(e), 'traceback': traceback.format_exc()}))
        sys.exit(1)
