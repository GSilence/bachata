#!/usr/bin/env python3
"""
Bachata Track Analysis v2
=========================
Новый алгоритм определения рядов и мостиков.
Основан на подсчёте доминирования Row 1 над Row 5.

Фазы:
0. Классификация (2 пика = бачата, 4 пика = попса)
1. Вычисление Row 1 и Row 5 (поиск начала, проверка доминирования)
2. Анализ КВАДРАТ (madmom по частям 1/1, 1/2, 1/3, 1/5)
3. Анализ МОСТИК (индикаторы → фильтрация → проверка доминирования)
"""

import sys
import os
import json
import warnings

# --- CRITICAL PATCHES ---
import collections
import collections.abc
import numpy as np

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
import tempfile

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
    from madmom.features.tempo import TempoEstimationProcessor
except ImportError as e:
    print(f"Error: madmom is required: {e}", file=sys.stderr)
    sys.exit(1)


# ==========================================
# CONFIG
# ==========================================

def load_config():
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'analysis-thresholds.json')
    defaults = {
        'energy_threshold_reduction': 0.30,
        'initial_quarters_count': 8,
        'bridge_dominance_threshold': 0.03,
        'indicator_window': 4,
        'popsa_peak_threshold': 0.70,
    }
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                cfg = json.load(f)
                v2 = cfg.get('v2_algorithm', {})
                for k, v in defaults.items():
                    defaults[k] = v2.get(k, v)
    except Exception as e:
        print(f"[Config] Failed: {e}, using defaults", file=sys.stderr)
    return defaults


# ==========================================
# HELPERS
# ==========================================

def get_band_energy(y, sr, time_sec, window_sec=0.08):
    """RMS энергия в окне вокруг бита (полный спектр)."""
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end:
        return 0.0
    chunk = y[start:end]
    return float(np.sqrt(np.mean(chunk ** 2)))


def log(msg):
    print(msg, file=sys.stderr)


# ==========================================
# ФАЗА 0: Классификация (2 vs 4 пика)
# ==========================================

def classify_peaks(activations, all_beats, rnn_fps):
    """
    Заход 1 Фазы 1: Определяем два пиковых ряда по МАДМОМ.
    Не сравниваем, какой сильнее — только фиксируем: эти два ряда изучаем дальше.
    Условно: первый по порядку (меньшая позиция 0–7) = РАЗ (ряд 1), второй = ПЯТЬ (ряд 5).
    Возвращает: (peak_count, peak1_pos, peak2_pos)
    """
    # Собираем madmom scores по позициям 0-7
    position_scores = [[] for _ in range(8)]

    for i, beat_time in enumerate(all_beats):
        pos = i % 8
        frame = min(int(beat_time * rnn_fps), len(activations) - 1)
        score = float(activations[frame, 1]) if activations.ndim > 1 else float(activations[frame])
        position_scores[pos].append(score)

    avg_scores = [np.mean(s) if s else 0.0 for s in position_scores]
    log(f"[Phase 0] Avg madmom by position (0-7): {[f'{v:.3f}' for v in avg_scores]}")

    # Находим 2 самых сильных пика (какие два ряда изучаем)
    sorted_positions = sorted(range(8), key=lambda p: avg_scores[p], reverse=True)
    peak1_pos = sorted_positions[0]
    peak2_pos = sorted_positions[1]

    # Убеждаемся что пики разнесены на ~4 позиции (как 1 и 5 в восьмёрке)
    expected_second = (peak1_pos + 4) % 8
    if abs((peak2_pos - expected_second) % 8) > 1:
        candidates = [(p, avg_scores[p]) for p in range(8) if abs((p - expected_second) % 8) <= 1]
        if candidates:
            peak2_pos = max(candidates, key=lambda x: x[1])[0]

    # Упорядочиваем по позиции: меньшая = РАЗ (ряд 1), большая = ПЯТЬ (ряд 5)
    if peak1_pos > peak2_pos:
        peak1_pos, peak2_pos = peak2_pos, peak1_pos

    score_peak1 = avg_scores[peak1_pos]
    score_peak2 = avg_scores[peak2_pos]

    log(f"[Phase 0] Main peaks at positions: {peak1_pos} ({score_peak1:.3f}), {peak2_pos} ({score_peak2:.3f})")

    # Проверяем промежуточные позиции (между двумя главными пиками)
    # Если они тоже сильные — это 4 пика (попса)
    config = load_config()
    threshold = config['popsa_peak_threshold']

    mid1 = (peak1_pos + 2) % 8  # позиция между peak1 и peak2
    mid2 = (peak2_pos + 2) % 8  # позиция между peak2 и peak1 (через цикл)
    score_mid1 = avg_scores[mid1]
    score_mid2 = avg_scores[mid2]

    ref_score = max(score_peak1, score_peak2, 0.001)
    ratio_mid1 = score_mid1 / ref_score
    ratio_mid2 = score_mid2 / ref_score

    log(f"[Phase 0] Mid positions: {mid1} ({score_mid1:.3f}, ratio={ratio_mid1:.2f}), "
        f"{mid2} ({score_mid2:.3f}, ratio={ratio_mid2:.2f}), threshold={threshold}")

    if ratio_mid1 >= threshold and ratio_mid2 >= threshold:
        log("[Phase 0] Result: 4 peaks (POPSA)")
        return 4, peak1_pos, peak2_pos
    else:
        log("[Phase 0] Result: 2 peaks (standard bachata)")
        return 2, peak1_pos, peak2_pos


# ==========================================
# ФАЗА 1: Вычисление Row 1 и Row 5
# ==========================================

def compute_beat_data(all_beats, activations, rnn_fps, y, sr):
    """Вычисляет energy и madmom_score для каждого бита."""
    beats = []
    for i, beat_time in enumerate(all_beats):
        energy = get_band_energy(y, sr, beat_time)
        frame = min(int(beat_time * rnn_fps), len(activations) - 1)
        madmom_score = float(activations[frame, 1]) if activations.ndim > 1 else float(activations[frame])
        beats.append({
            'id': i,
            'time': beat_time,
            'energy': energy,
            'madmom_score': madmom_score,
        })
    return beats


def build_strong_rows_tact_table(beats, peak1_pos, peak2_pos):
    """
    Строим таблицу тактов для сильных рядов (peak1 и peak2).
    Для каждого бита сильного ряда: такт = этот бит + следующие 3.
    tact_sum = сумма энергий 4 битов, tact_avg = tact_sum / 4.
    Возвращает: (table_list, table_by_row)
    - table_list: список всех тактов по порядку битов [{row_position, beat, time_sec, tact_sum, tact_avg}, ...]
    - table_by_row: {peak1_pos: [...], peak2_pos: [...]} для вывода по рядам.
    """
    if len(beats) < 4:
        return [], {}

    table_list = []
    table_by_row = {peak1_pos: [], peak2_pos: []}

    # Кандидаты: биты, с которых начинается такт сильного ряда (i % 8 in {peak1_pos, peak2_pos})
    for i in range(len(beats) - 3):
        pos = i % 8
        if pos != peak1_pos and pos != peak2_pos:
            continue
        tact_sum = sum(beats[j]['energy'] for j in range(i, i + 4))
        tact_avg = tact_sum / 4.0
        row = {
            'row_position': pos,
            'beat': i,
            'time_sec': round(beats[i]['time'], 2),
            'tact_sum': round(tact_sum, 4),
            'tact_avg': round(tact_avg, 4),
        }
        table_list.append(row)
        table_by_row[pos].append(row)

    return table_list, table_by_row


def find_song_start(beats, config, peak1_pos, peak2_pos):
    """
    Заход 2 Фазы 1: Ищем первый такт (по порядку: 1-й такт ряда 1, 1-й ряда 5, 2-й ряда 1, …),
    у которого сумма такта > (среднее × 0.70) × 4. Начало этого такта = РАЗ, от него строим сетку.
    Возвращает: (start_idx, strong_rows_tact_table)
    """
    if len(beats) < 4:
        return 0, [], {}

    # Пороговая сумма такта (4 бита) = (mean × 0.70) × 4
    all_energies = [b['energy'] for b in beats]
    mean_energy = float(np.mean(all_energies))
    reduction = config['energy_threshold_reduction']
    threshold_per_beat = mean_energy * (1.0 - reduction)
    threshold_tact_sum = 4 * threshold_per_beat

    log(f"[Phase 1] Mean energy (all beats): {mean_energy:.4f}, threshold tact sum: {threshold_tact_sum:.4f} (= (mean-30%)×4)")

    table_list, table_by_row = build_strong_rows_tact_table(beats, peak1_pos, peak2_pos)

    # Порядок: 1-й такт ряда 1, 1-й ряда 5, 2-й ряда 1, 2-й ряда 5, … (table_list уже в таком порядке)
    for row in table_list:
        if row['tact_sum'] > threshold_tact_sum:
            start_idx = row['beat']
            log(f"[Phase 1] Song start (РАЗ) at beat {start_idx} (time {beats[start_idx]['time']:.2f}s), "
                f"row_position={row['row_position']}, tact_sum={row['tact_sum']:.4f} > {threshold_tact_sum:.4f}")
            return start_idx, table_list, table_by_row

    log("[Phase 1] No start found in strong rows, using beat 0")
    return 0, table_list, table_by_row


def determine_rows(beats, start_idx, config):
    """
    Заход 3 Фазы 1: Итоговый истинный РАЗ.
    Суммы первых 8 тактов ряда 1 и ряда 5 (от найденного РАЗ).
    Если ряд 5 > ряд 1 — обрезаем до первых 4 тактов в каждом ряду; если после обрезки
    ряд 5 всё ещё доминирует → истинный РАЗ = ряд 5 (своп). Иначе истинный РАЗ = ряд 1.
    Возвращает: (row1_offset, row_swapped)
    """
    n_quarters = config['initial_quarters_count']  # 8

    # Первые 8 тактов ряда 1 (start_idx, start_idx+8, ...) и ряда 5 (start_idx+4, start_idx+12, ...)
    row1_energy_sums = []
    row5_energy_sums = []

    for q in range(n_quarters):
        r1_start = start_idx + q * 8
        r5_start = start_idx + q * 8 + 4

        if r1_start + 3 < len(beats):
            row1_energy_sums.append(sum(beats[j]['energy'] for j in range(r1_start, r1_start + 4)))
        if r5_start + 3 < len(beats):
            row5_energy_sums.append(sum(beats[j]['energy'] for j in range(r5_start, r5_start + 4)))

    if not row1_energy_sums or not row5_energy_sums:
        return 0, False

    sum_r1 = sum(row1_energy_sums)
    sum_r5 = sum(row5_energy_sums)

    log(f"[Phase 1] Pass 3 — Row 1 sum (first 8): {sum_r1:.4f}, Row 5 sum (first 8): {sum_r5:.4f}")

    if sum_r1 > sum_r5:
        log("[Phase 1] Row 1 dominates — true РАЗ = row 1")
        return 0, False

    # Ряд 5 больше → обрезаем: оставляем только первые 4 такта в каждом ряду (убираем с конца)
    trim_count = 4
    r1_first4 = row1_energy_sums[:trim_count]
    r5_first4 = row5_energy_sums[:trim_count]
    if not r1_first4 or not r5_first4:
        log("[Phase 1] Not enough data for trim, keeping order")
        return 0, False

    sum_r1_trim = sum(r1_first4)
    sum_r5_trim = sum(r5_first4)
    log(f"[Phase 1] After trim (first 4 only): Row 1={sum_r1_trim:.4f}, Row 5={sum_r5_trim:.4f}")

    if sum_r1_trim > sum_r5_trim:
        log("[Phase 1] After trim Row 1 dominates — true РАЗ = row 1")
        return 0, False

    log("[Phase 1] Row 5 still dominates — true РАЗ = row 5, swap (song starts from row 5)")
    return 4, True


# ==========================================
# ФАЗА 2: Анализ КВАДРАТ
# ==========================================

def analyze_square(beats, start_idx, row1_offset):
    """
    Делим песню на РАВНЫЕ части по битам (в каждой части поровну РАЗ и ПЯТЬ).
    Хвост при делении отбрасываем с конца. Сравниваем по мадмому и по энергии.
    Зелёный: row1 > row5, красный: иначе. Вердикт has_bridges если есть красный (по мадмому или энергии).
    """
    active_beats = beats[start_idx:]
    n = len(active_beats)

    if n < 8:
        return {'parts': {}, 'verdict': 'insufficient_data'}

    # Используем только полные 8-битные циклы (поровну РАЗ и ПЯТЬ в каждой части)
    n_used = (n // 8) * 8
    if n_used < 8:
        return {'parts': {}, 'verdict': 'insufficient_data'}
    used = active_beats[:n_used]

    def compare_part(beat_slice):
        """Сравнивает Row 1 vs Row 5 по мадмому и по энергии. Возвращает суммы, статусы и временной промежуток."""
        r1_m, r5_m = 0.0, 0.0
        r1_e, r5_e = 0.0, 0.0
        for idx, b in enumerate(beat_slice):
            pos_in_8 = (idx + row1_offset) % 8
            if pos_in_8 < 4:
                r1_m += b['madmom_score']
                r1_e += b['energy']
            else:
                r5_m += b['madmom_score']
                r5_e += b['energy']
        status_m = 'green' if r1_m > r5_m else 'red'
        status_e = 'green' if r1_e > r5_e else 'red'
        time_start = round(beat_slice[0]['time'], 2)
        time_end = round(beat_slice[-1]['time'], 2)
        return {
            'row1_madmom': round(r1_m, 4), 'row5_madmom': round(r5_m, 4), 'status_madmom': status_m,
            'row1_energy': round(r1_e, 4), 'row5_energy': round(r5_e, 4), 'status_energy': status_e,
            'status': status_e,  # verdict based only on energy; madmom is informational
            'time_start': time_start,
            'time_end': time_end,
        }

    parts = {}

    # 1/1 — вся использованная песня
    parts['1/1'] = compare_part(used)

    # 1/2 — две равные части (размер кратен 8)
    part_size_2 = (n_used // 2) // 8 * 8
    if part_size_2 >= 8:
        parts['1/2_first'] = compare_part(used[:part_size_2])
        parts['1/2_second'] = compare_part(used[part_size_2:2 * part_size_2])

    # 1/3 — три равные части
    part_size_3 = (n_used // 3) // 8 * 8
    if part_size_3 >= 8:
        parts['1/3_first'] = compare_part(used[0:part_size_3])
        parts['1/3_second'] = compare_part(used[part_size_3:2 * part_size_3])
        parts['1/3_third'] = compare_part(used[2 * part_size_3:3 * part_size_3])

    # 1/5 — пять равных частей
    part_size_5 = (n_used // 5) // 8 * 8
    if part_size_5 >= 8:
        for i in range(5):
            parts[f'1/5_{i+1}'] = compare_part(used[i * part_size_5:(i + 1) * part_size_5])

    # Вердикт: есть красный (по мадмому или по энергии) → мостиковый анализ
    has_red = any(p['status'] == 'red' for p in parts.values())
    verdict = 'has_bridges' if has_red else 'square_confirmed'

    # Разница в % — на сколько РАЗ больше ПЯТЬ: (R1-R5)/R5*100 (0% = поровну, отрицательный = ПЯТЬ больше)
    # Считаем для всех (и square_confirmed, и has_bridges), чтобы в отчёте всегда было значение
    row_dominance_pct = None
    if parts:
        total_r1 = sum(p['row1_energy'] for p in parts.values())
        total_r5 = sum(p['row5_energy'] for p in parts.values())
        if total_r5 > 0:
            row_dominance_pct = round((total_r1 - total_r5) / total_r5 * 100, 2)

    log(f"[Phase 2] Square analysis: {verdict} (n_used={n_used}, tail dropped={n - n_used})")
    if row_dominance_pct is not None:
        log(f"  row_dominance_pct ((R1-R5)/R5*100): {row_dominance_pct}%")
    for name, p in parts.items():
        log(f"  {name}: madmom R1={p['row1_madmom']} R5={p['row5_madmom']} → {p['status_madmom']} | "
            f"energy R1={p['row1_energy']} R5={p['row5_energy']} → {p['status_energy']}")

    out = {'parts': parts, 'verdict': verdict}
    if row_dominance_pct is not None:
        out['row_dominance_pct'] = row_dominance_pct
    return out


# ==========================================
# ROW ANALYSIS (как в корреляции: 8 рядов по ГЛОБАЛЬНОЙ сетке, madmom sum/avg/max)
# ==========================================

def compute_row_analysis(beats, start_idx, peak1_pos, peak2_pos):
    """
    Распределяем ВСЕ биты по 8 рядам так же, как в корреляции:
    Row 1 = биты 0, 8, 16, ... (global index % 8 == 0)
    Row 2 = 1, 9, 17, ...
    ...
    Row 8 = 7, 15, 23, ...
    Никакого сдвига от start_idx — таблица совпадает с корреляцией.
    Победившие ряды = два пиковых (peak1_pos+1, peak2_pos+1), выделяем их оба.
    """
    row_data = {r: {'beat_indices': [], 'madmom_scores': []} for r in range(1, 9)}
    for i in range(len(beats)):
        pos = i % 8
        row_num = pos + 1
        row_data[row_num]['beat_indices'].append(i)
        row_data[row_num]['madmom_scores'].append(beats[i]['madmom_score'])

    row_analysis = {}
    for row_num in range(1, 9):
        rd = row_data[row_num]
        scores = rd['madmom_scores']
        count = len(scores)
        if not scores:
            row_analysis[f'row_{row_num}'] = {
                'count': 0,
                'madmom_sum': 0.0,
                'madmom_avg': 0.0,
                'madmom_max': 0.0,
                'madmom_min': 0.0,
            }
        else:
            row_analysis[f'row_{row_num}'] = {
                'count': count,
                'madmom_sum': round(float(np.sum(scores)), 3),
                'madmom_avg': round(float(np.mean(scores)), 3),
                'madmom_max': round(float(np.max(scores)), 3),
                'madmom_min': round(float(np.min(scores)), 3),
            }

    # Победившие ряды = два пиковых (1 и 5 в смысле счёта)
    peak_row_1 = peak1_pos + 1
    peak_row_2 = peak2_pos + 1
    sum1 = row_analysis[f'row_{peak_row_1}']['madmom_sum']
    sum2 = row_analysis[f'row_{peak_row_2}']['madmom_sum']
    winning_row = peak_row_1 if sum1 >= sum2 else peak_row_2
    # Ряд, с которого начинается песня = РАЗ (для знака <<)
    row_one = (start_idx % 8) + 1
    verdict = {
        'winning_row': winning_row,
        'winning_rows': [peak_row_1, peak_row_2],
        'row_one': row_one,
        'start_beat_id': start_idx,
        'start_time': round(beats[start_idx]['time'], 3),
        'reason': 'v2: two peak rows (1 and 5)',
    }
    return row_analysis, verdict


# ==========================================
# ИНДИКАТОРЫ
# ==========================================

def compute_quarters(beats, start_idx, row1_offset):
    """
    Строим таблицу четвёрок с суммарной энергией.
    Каждая четвёрка: {index, beat_start, time, energy_sum, position: '1-4'|'5-8'}.
    """
    quarters = []
    active_beats = beats[start_idx:]
    n = len(active_beats)

    q_idx = 0
    i = 0
    while i + 3 < n:
        energy_sum = sum(active_beats[j]['energy'] for j in range(i, i + 4))
        pos_in_8 = (q_idx + (row1_offset // 4)) % 2  # 0 = Row 1-4, 1 = Row 5-8
        position = '1-4' if pos_in_8 == 0 else '5-8'
        quarters.append({
            'index': q_idx,
            'beat_start_global': start_idx + i,
            'beat_start_local': i,
            'time': active_beats[i]['time'],
            'energy_sum': energy_sum,
            'position': position,
        })
        q_idx += 1
        i += 4

    return quarters


def compute_indicators_from_tacts(strong_rows_tact_list, start_idx, beats, config):
    """
    Индикаторы по рядам 1 и 5 (в порядке трека). Используем энергию пикового бита, не сумму такта.
    Каждая позиция в списке — один такт (начало такта = бит ряда 1 или 5); значение = energy[beat].
    Для каждой позиции (начиная с 5-й: окно ±4 = 9 позиций):
      probability = MIN(энергии битов в окне i-4 .. i+4) / энергия бита i.
    Аналог Excel: =МИН(E2:E10)/E6. 100% — подозрение на мостик (индикатор).
    Возвращает: (indicators, indicator_tact_table).
    """
    window = config['indicator_window']  # 4
    song_tacts = [t for t in strong_rows_tact_list if t['beat'] >= start_idx]
    if len(song_tacts) < 2 * window + 1:
        log(f"[Phase 3] Not enough song positions for window ±{window} (have {len(song_tacts)})")
        return [], []

    # Энергия пикового бита для каждой позиции (бит начала такта ряда 1/5)
    n_beats = len(beats)
    beat_energies = []
    for t in song_tacts:
        bi = t['beat']
        e = beats[bi]['energy'] if bi < n_beats else 0.0
        beat_energies.append(e)

    indicators = []
    indicator_tact_table = []

    for i in range(window, len(song_tacts) - window):
        window_energies = [beat_energies[j] for j in range(i - window, i + window + 1)]
        min_in_window = min(window_energies)
        current = beat_energies[i]
        if current <= 0:
            continue
        probability = min_in_window / current
        pct = round(probability * 100, 2)

        beat = song_tacts[i]['beat']
        time_sec = song_tacts[i]['time_sec']
        pos_in_8 = (beat - start_idx) % 8
        position = '1-4' if pos_in_8 < 4 else '5-8'
        quarter_index = (beat - start_idx) // 4

        indicator_tact_table.append({
            'tact_index': i,
            'beat': beat,
            'time_sec': time_sec,
            'beat_energy': round(beat_energies[i], 4),
            'probability_pct': pct,
            'position': position,
        })

        if abs(probability - 1.0) < 1e-9:
            indicators.append({
                'quarter_index': quarter_index,
                'tact_index': i,
                'beat': beat,
                'time_sec': time_sec,
                'energy_sum': round(beat_energies[i], 4),
                'probability': 1.0,
                'position': position,
            })

    log(f"[Phase 3] Positions (row1/5): {len(song_tacts)}, with full window: {len(indicator_tact_table)}, indicators (100%): {len(indicators)}")
    for ind in indicators:
        log(f"  Pos {ind['tact_index']}: beat={ind['beat']}, time={ind['time_sec']}s, pos={ind['position']}")

    return indicators, indicator_tact_table


# ==========================================
# ФАЗА 3: Анализ МОСТИК
# ==========================================

# Терминология: Малый квадрат (МК) = 2 восьмёрки = 2 РАЗ + 2 ПЯТЬ = 16 битов = 4 четверти.
# Квадрат = 4 восьмёрки = 4 РАЗ + 4 ПЯТЬ = 32 бита = 8 четвертей.
QUARTERS_PER_SMALL_SQUARE = 4   # 1 МК
QUARTERS_PER_SQUARE = 8         # 1 Квадрат


def analyze_bridges(indicators, quarters, config):
    """
    Фаза после индикаторов:
    - Индикатор на 5-8 → брейк, игнорируем.
    - Индикатор на 1-4 в том же Малом квадрате, что и последний мост → игнорируем.
    - Сначала смотрим только Квадрат (4 восьмёрки = 8 четвертей) после индикатора. Если разница РАЗ/ПЯТЬ < 3% —
      добавляем к сумме ещё один Малый квадрат (2 восьмёрки = 4 четверти), смотрим итог (квадрат + малый квадрат).
    - Ряды поменялись (R5 > R1) → мостик, своп раскладки.
    """
    threshold = config['bridge_dominance_threshold']
    bridges = []
    decisions = []
    last_bridge_quarter = -999

    for ind in indicators:
        qi = ind['quarter_index']
        pos_physical = ind['position']  # 1-4 или 5-8 в исходной сетке

        # Текущая позиция с учётом уже подтверждённых мостов: после нечётного числа мостов раскладка свопнута
        n_swaps = len(bridges)
        pos_in_layout = pos_physical if n_swaps % 2 == 0 else ('5-8' if pos_physical == '1-4' else '1-4')

        if pos_in_layout == '5-8':
            decisions.append({**ind, 'action': 'ignored_break', 'reason': 'На ряде 5-8 в текущей раскладке (брейк)'})
            log(f"  Indicator Q{qi}: BREAK (row 5-8 in current layout, physical was {pos_physical})")
            continue

        # Тот же Малый квадрат, что и последний мост (2 моста в одном МК быть не может)
        if last_bridge_quarter >= 0 and (qi // QUARTERS_PER_SMALL_SQUARE) == (last_bridge_quarter // QUARTERS_PER_SMALL_SQUARE):
            decisions.append({**ind, 'action': 'ignored_same_square',
                              'reason': 'В этом малом квадрате уже был мостик'})
            log(f"  Indicator Q{qi}: IGNORED (same small square as bridge at Q{last_bridge_quarter})")
            continue

        # Сначала только Квадрат (4 восьмёрки = 8 четвертей) после индикатора
        next_square_start = (qi // QUARTERS_PER_SQUARE + 1) * QUARTERS_PER_SQUARE
        r1_sum, r5_sum = _sum_next_quarters(quarters, next_square_start, count=QUARTERS_PER_SQUARE)

        if r1_sum == 0 and r5_sum == 0:
            decisions.append({**ind, 'action': 'ignored_no_data', 'reason': 'Нет данных для следующего квадрата'})
            continue

        total = max(r1_sum, r5_sum, 0.001)
        diff_pct = abs(r1_sum - r5_sum) / total

        log(f"  Indicator Q{qi}: next Квадрат from Q{next_square_start}, r1={r1_sum:.4f}, r5={r5_sum:.4f}, diff={diff_pct:.4f}")

        # Разница < 3% — добавляем к сумме один Малый квадрат (4 четверти), смотрим что получилось
        if diff_pct < threshold:
            log(f"  Diff < {threshold*100:.0f}%, adding 1 Малый квадрат to sum")
            r1_sum, r5_sum = _sum_next_quarters(quarters, next_square_start, count=QUARTERS_PER_SQUARE + QUARTERS_PER_SMALL_SQUARE)
            total = max(r1_sum, r5_sum, 0.001)
            diff_pct = abs(r1_sum - r5_sum) / total
            log(f"  Квадрат+МК: r1={r1_sum:.4f}, r5={r5_sum:.4f}, diff={diff_pct:.4f}")

            if diff_pct < threshold:
                decisions.append({**ind, 'action': 'ignored_small_diff',
                                  'reason': f'Разница <{threshold*100:.0f}% ({diff_pct*100:.2f}%), квадрат+МК сохраняют ряды',
                                  'row1_sum': round(r1_sum, 4), 'row5_sum': round(r5_sum, 4),
                                  'diff_pct': round(diff_pct * 100, 2)})
                log(f"  IGNORED (diff still < {threshold*100:.0f}%)")
                continue

        # Ряды поменялись? (R5 > R1 → мостик)
        if r5_sum > r1_sum:
            bridges.append({
                'beat': ind['beat'],
                'time_sec': ind['time_sec'],
                'quarter_index': qi,
                'row1_sum': round(r1_sum, 4),
                'row5_sum': round(r5_sum, 4),
                'diff_pct': round(diff_pct * 100, 2),
            })
            decisions.append({**ind, 'action': 'bridge_confirmed',
                              'reason': f'Row5 > Row1 ({r5_sum:.4f} > {r1_sum:.4f}), ряды поменялись',
                              'row1_sum': round(r1_sum, 4), 'row5_sum': round(r5_sum, 4),
                              'diff_pct': round(diff_pct * 100, 2)})
            last_bridge_quarter = qi
            _swap_quarters_after(quarters, qi)
            log(f"  BRIDGE CONFIRMED at Q{qi} (beat {ind['beat']}, {ind['time_sec']}s)")
        else:
            decisions.append({**ind, 'action': 'ignored_no_change',
                              'reason': f'Row1 >= Row5 ({r1_sum:.4f} >= {r5_sum:.4f}), ряды не меняются',
                              'row1_sum': round(r1_sum, 4), 'row5_sum': round(r5_sum, 4),
                              'diff_pct': round(diff_pct * 100, 2)})
            log(f"  IGNORED (rows unchanged)")

    return bridges, decisions


def _sum_next_quarters(quarters, start_qi, count=4):
    """Суммирует энергию Row 1 и Row 5 для count четвёрок начиная с start_qi."""
    r1_sum = 0.0
    r5_sum = 0.0
    added = 0

    for i in range(start_qi, min(start_qi + count, len(quarters))):
        q = quarters[i]
        if q['position'] == '1-4':
            r1_sum += q['energy_sum']
        else:
            r5_sum += q['energy_sum']
        added += 1

    return r1_sum, r5_sum


def _swap_quarters_after(quarters, bridge_qi):
    """Меняем позиции 1-4 <-> 5-8 для всех четвёрок после моста."""
    for i in range(bridge_qi + 1, len(quarters)):
        if quarters[i]['position'] == '1-4':
            quarters[i]['position'] = '5-8'
        else:
            quarters[i]['position'] = '1-4'


# ==========================================
# АНАЛИЗ ПОПСА
# ==========================================

def analyze_popsa(beats, start_idx):
    """
    Раскладка для 4-пикового трека: чередуем Row 1 и Row 5,
    каждая сильная доля = счёт 1.
    """
    layout = []
    active_beats = beats[start_idx:]
    # Каждая четвёрка — отдельный "ряд", чередуя 1-4 и 5-8
    i = 0
    while i + 3 < len(active_beats):
        layout.append({
            'from_beat': start_idx + i,
            'to_beat': start_idx + i + 3,
            'time_start': active_beats[i]['time'],
            'time_end': active_beats[min(i + 3, len(active_beats) - 1)]['time'],
            'row1_start': 1 if (i // 4) % 2 == 0 else 5,
        })
        i += 4
    return layout


# ==========================================
# ГЕНЕРАЦИЯ LAYOUT
# ==========================================

def generate_layout(quarters, bridges, start_idx, beats):
    """
    Генерирует финальную раскладку рядов с учётом мостиков.
    """
    if not quarters:
        return []

    bridge_beats = set(b['beat'] for b in bridges)
    layout = []
    current_row_start = 1
    segment_start_beat = quarters[0]['beat_start_global']

    for i, q in enumerate(quarters):
        if q['beat_start_global'] in bridge_beats:
            # Закрываем текущий сегмент
            if layout or segment_start_beat is not None:
                layout.append({
                    'from_beat': segment_start_beat,
                    'to_beat': q['beat_start_global'] - 1,
                    'time_start': round(beats[segment_start_beat]['time'], 2),
                    'time_end': round(beats[max(0, q['beat_start_global'] - 1)]['time'], 2),
                    'row1_start': current_row_start,
                })
            # Свопаем
            current_row_start = 5 if current_row_start == 1 else 1
            segment_start_beat = q['beat_start_global']

    # Последний сегмент
    last_beat = quarters[-1]['beat_start_global'] + 3
    last_beat = min(last_beat, len(beats) - 1)
    layout.append({
        'from_beat': segment_start_beat,
        'to_beat': last_beat,
        'time_start': round(beats[segment_start_beat]['time'], 2),
        'time_end': round(beats[last_beat]['time'], 2),
        'row1_start': current_row_start,
    })

    return layout


# ==========================================
# MAIN ANALYSIS
# ==========================================

def analyze_v2(audio_path):
    config = load_config()

    # --- Загрузка аудио ---
    log(f"Loading audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = len(y) / sr
    log(f"Duration: {duration:.1f}s, SR: {sr}")

    # --- Madmom RNN ---
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp_path = tmp.name
    sf.write(tmp_path, y, sr)

    try:
        log("Running RNNDownBeatProcessor...")
        proc = RNNDownBeatProcessor()
        activations = proc(tmp_path)
        rnn_fps = 100.0

        log("Tracking beats...")
        beat_processor = DBNBeatTrackingProcessor(fps=100)
        beat_times = beat_processor(activations[:, 0])
        all_beats = [float(b) for b in beat_times]
    finally:
        try:
            os.unlink(tmp_path)
        except:
            pass

    if len(all_beats) < 16:
        return {'success': False, 'error': f'Not enough beats ({len(all_beats)})'}

    # --- BPM ---
    log("Calculating BPM...")
    intervals = np.diff(all_beats)
    bpm_mean = 60.0 / np.mean(intervals)
    try:
        tempo_proc = TempoEstimationProcessor(fps=100, min_bpm=60, max_bpm=190)
        tempos = tempo_proc(activations)
        if len(tempos) > 0:
            ratio = tempos[0][0] / bpm_mean
            if 1.8 < ratio < 2.2:
                bpm_mean *= 2
            elif 0.4 < ratio < 0.6:
                bpm_mean /= 2
    except:
        pass
    bpm = int(round(bpm_mean))
    log(f"BPM: {bpm}")

    # --- Вычисление побитовых данных ---
    beats = compute_beat_data(all_beats, activations, rnn_fps, y, sr)

    # === ФАЗА 0: Классификация ===
    peaks, peak1_pos, peak2_pos = classify_peaks(activations, all_beats, rnn_fps)
    log(f"[Phase 0] Peak positions in 8-beat cycle: {peak1_pos}, {peak2_pos}")

    # === ФАЗА 1: Поиск начала и определение рядов (только по тактам сильных рядов) ===
    start_idx, strong_rows_tact_list, strong_rows_tact_by_row = find_song_start(
        beats, config, peak1_pos, peak2_pos
    )
    # Лог таблицы тактов сильных рядов (первые 20 записей)
    log("[Phase 1] Strong rows tact table (first 20):")
    for r in strong_rows_tact_list[:20]:
        log(f"  row_pos={r['row_position']} beat={r['beat']} time={r['time_sec']}s tact_sum={r['tact_sum']} tact_avg={r['tact_avg']}")
    if len(strong_rows_tact_list) > 20:
        log(f"  ... and {len(strong_rows_tact_list) - 20} more")

    row1_offset, row_swapped = determine_rows(beats, start_idx, config)
    # При свопе row1_offset=4: истинный РАЗ = ряд 5, метки 1-4/5-8 сдвигаются в compute_quarters.

    # === Попса ===
    if peaks == 4:
        layout = analyze_popsa(beats, start_idx)
        # Счёт битов с 1 в выходном JSON
        return {
            'success': True,
            'version': 'v2',
            'track_type': 'popsa',
            'peaks_per_octave': 4,
            'bpm': bpm,
            'duration': round(duration, 2),
            'song_start_beat': start_idx + 1,
            'song_start_time': round(beats[start_idx]['time'], 2),
            'layout': [{'from_beat': s['from_beat'] + 1, 'to_beat': s['to_beat'] + 1,
                       'time_start': s['time_start'], 'time_end': s['time_end'],
                       'row1_start': s['row1_start']} for s in layout],
            'indicators': [],
            'bridges': [],
            'square_analysis': {'parts': {}, 'verdict': 'popsa'},
            'beat_base': 1,
        'per_beat_data': [{'id': b['id'] + 1, 'time': round(b['time'], 3),
                               'energy': round(b['energy'], 4),
                               'madmom_score': round(b['madmom_score'], 4)}
                              for b in beats],
        }

    # === ФАЗА 2: Анализ КВАДРАТ ===
    square_result = analyze_square(beats, start_idx, row1_offset)

    # === ФАЗА 3: Индикаторы (по тактам рядов 1 и 5) и мостики ===
    quarters = compute_quarters(beats, start_idx, row1_offset)
    indicators, indicator_tact_table = compute_indicators_from_tacts(
        strong_rows_tact_list, start_idx, beats, config
    )

    bridges = []
    indicator_decisions = []

    if square_result['verdict'] == 'has_bridges':
        bridges, indicator_decisions = analyze_bridges(indicators, quarters, config)
    else:
        # Квадрат подтверждён, индикаторы не обрабатываем
        indicator_decisions = [{**ind, 'action': 'not_processed', 'reason': 'Квадрат подтверждён'}
                               for ind in indicators]

    # === Layout ===
    layout = generate_layout(quarters, bridges, start_idx, beats)

    # === Суммы первых 2 квадратов для отчёта ===
    initial_r1, initial_r5 = 0.0, 0.0
    for q in quarters[:config['initial_quarters_count'] * 2]:
        if q['position'] == '1-4':
            initial_r1 += q['energy_sum']
        else:
            initial_r5 += q['energy_sum']

    # === Row Analysis (как в корреляции: 8 рядов, Beats/Sum/Avg/Max) ===
    row_analysis, row_analysis_verdict = compute_row_analysis(
        beats, start_idx, peak1_pos, peak2_pos
    )

    # Счёт битов с 1 в выходном JSON (внутри скрипта везде 0-based)
    def beat1(x):
        return x + 1

    result = {
        'success': True,
        'version': 'v2',
        'track_type': 'bachata',
        'peaks_per_octave': 2,
        'bpm': bpm,
        'duration': round(duration, 2),
        'song_start_beat': beat1(start_idx),
        'song_start_time': round(beats[start_idx]['time'], 2),
        'row1_sum': round(initial_r1, 4),
        'row5_sum': round(initial_r5, 4),
        'row_swapped': row_swapped,
        'strong_rows_tact_table': [{**r, 'beat': beat1(r['beat'])} for r in strong_rows_tact_list],
        'strong_rows_tact_by_row': {
            str(k): [{**x, 'beat': beat1(x['beat'])} for x in v]
            for k, v in strong_rows_tact_by_row.items()
        },
        'row_analysis': row_analysis,
        'row_analysis_verdict': {**row_analysis_verdict, 'start_beat_id': beat1(start_idx)},
        'square_analysis': square_result,
        'indicator_tact_table': [
            {**t, 'beat': beat1(t['beat']), 'probability_pct': t['probability_pct']}
            for t in indicator_tact_table
        ],
        'indicators': [{**ind, 'beat': beat1(ind['beat'])} for ind in indicator_decisions],
        'bridges': [{**b, 'beat': beat1(b['beat'])} for b in bridges],
        'layout': [{'from_beat': beat1(s['from_beat']), 'to_beat': beat1(s['to_beat']),
                   'time_start': s['time_start'], 'time_end': s['time_end'],
                   'row1_start': s['row1_start']} for s in layout],
        'quarters': [{
            'index': q['index'],
            'beat': beat1(q['beat_start_global']),
            'time': round(q['time'], 2),
            'energy_sum': round(q['energy_sum'], 4),
            'position': q['position'],
        } for q in quarters],
        'beat_base': 1,
        'per_beat_data': [{'id': beat1(b['id']), 'time': round(b['time'], 3),
                           'energy': round(b['energy'], 4),
                           'madmom_score': round(b['madmom_score'], 4)}
                          for b in beats],
    }

    log(f"\n=== RESULT ===")
    log(f"Type: {result['track_type']}")
    log(f"Start: beat {start_idx} ({beats[start_idx]['time']:.2f}s)")
    log(f"Row swapped: {row_swapped}")
    log(f"Square: {square_result['verdict']}")
    log(f"Bridges: {len(bridges)}")
    for b in bridges:
        log(f"  Beat {b['beat']} ({b['time_sec']}s)")

    return result


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: analyze-track-v2.py <audio_path>'}))
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({'success': False, 'error': f'File not found: {audio_path}'}))
        sys.exit(1)

    result = analyze_v2(audio_path)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
