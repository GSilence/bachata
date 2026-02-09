#!/usr/bin/env python3
"""
Smart Row Correlation Analysis v2.0
====================================
Разделяет биты на 8 рядов и находит ряд с максимальной суммой madmom scores.
Этот ряд определяет правильную фазу для offset.

Алгоритм:
1. BPM: STRICT MEAN (как в других анализаторах)
2. Распределение всех битов по 8 рядам (по позиции в счёте 1-8)
3. Для каждого ряда считается сумма madmom downbeat scores
4. Ряд с максимальной суммой = "истинный РАЗ для танца"
5. Offset = время первого бита победившего ряда
"""

import sys
import os
import json
import warnings

# --- 1. CRITICAL PATCHES ---
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

# --- 2. IMPORTS ---
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
# CONFIG LOADING
# ==========================================

def load_thresholds_config():
    """Загружает пороговые значения из config/analysis-thresholds.json"""
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'analysis-thresholds.json')
    default = {
        'bridge': {'low': 0.30, 'high': 0.80},
        'break': {'low': 1.20, 'high': 1.85},
        'trim_seconds': 15.0,
        'confirm_beats': 1
    }
    try:
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                cfg = json.load(f)
                return {
                    'bridge': cfg.get('bridge', default['bridge']),
                    'break': cfg.get('break', default['break']),
                    'trim_seconds': cfg.get('trim_seconds', default['trim_seconds']),
                    'confirm_beats': int(cfg.get('confirm_beats', default['confirm_beats']))
                }
    except Exception as e:
        print(f"[Config] Failed to load thresholds: {e}, using defaults", file=sys.stderr)
    return default


# ==========================================
# HELPER FUNCTIONS (из analyze-track-improved.py)
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


# get_spectral_features removed — not used in CSV export


# ==========================================
# SMART ROW ANALYSIS
# ==========================================

def distribute_beats_to_rows(all_beats):
    """
    Распределяет биты по 8 рядам (счёт 1-8).

    total_beats / 8 = base_count + remainder
    Первые 'remainder' рядов получают base_count + 1 бит.
    Остальные получают base_count.

    Row 1: индексы 0, 8, 16, 24, ...
    Row 2: индексы 1, 9, 17, 25, ...
    ...
    Row 8: индексы 7, 15, 23, 31, ...
    """
    total_beats = len(all_beats)
    base_count = total_beats // 8
    remainder = total_beats % 8

    rows = {}

    for row_num in range(1, 9):
        beat_indices = []
        idx = row_num - 1
        while idx < total_beats:
            beat_indices.append(idx)
            idx += 8

        rows[row_num] = {
            'row_number': row_num,
            'beat_indices': beat_indices,
            'count': len(beat_indices),
            'expected_count': base_count + (1 if row_num <= remainder else 0)
        }

    return rows


def calculate_row_scores(rows, all_beats, activations, rnn_fps=100.0):
    """
    Для каждого ряда считаем сумму и среднее madmom downbeat scores.
    """
    for row_num, row_data in rows.items():
        madmom_scores = []

        for beat_idx in row_data['beat_indices']:
            beat_time = all_beats[beat_idx]
            frame = int(beat_time * rnn_fps)

            if frame < len(activations):
                score = float(activations[frame, 1])  # downbeat probability
                madmom_scores.append(score)

        row_data['madmom_scores'] = madmom_scores
        row_data['madmom_sum'] = sum(madmom_scores)
        row_data['madmom_avg'] = sum(madmom_scores) / len(madmom_scores) if madmom_scores else 0.0
        row_data['madmom_max'] = max(madmom_scores) if madmom_scores else 0.0
        row_data['madmom_min'] = min(madmom_scores) if madmom_scores else 0.0

        print(f"[Row {row_num}] Beats: {row_data['count']}, "
              f"Sum: {row_data['madmom_sum']:.3f}, "
              f"Avg: {row_data['madmom_avg']:.3f}", file=sys.stderr)

    return rows


def find_winning_row(rows, all_beats=None, activations=None, rnn_fps=100.0):
    """
    Находит ряд с максимальной суммой madmom scores.

    Логика v2.1:
    - Если разница между топ-1 и топ-2 >= 5% — победитель = ряд с максимальной суммой
    - Если разница < 5% — победитель = ряд с меньшим номером из двух конкурентов
    """
    # Сортируем ряды по сумме (убывание)
    sorted_rows = sorted(rows.items(), key=lambda x: x[1]['madmom_sum'], reverse=True)

    top1_row_num = sorted_rows[0][0]
    top1_sum = sorted_rows[0][1]['madmom_sum']
    top2_row_num = sorted_rows[1][0]
    top2_sum = sorted_rows[1][1]['madmom_sum']

    # Вычисляем разницу в процентах
    diff_pct = (top1_sum - top2_sum) / top1_sum * 100 if top1_sum > 0 else 100

    print(f"\n[Top 2] Row {top1_row_num} (Sum: {top1_sum:.3f}) vs "
          f"Row {top2_row_num} (Sum: {top2_sum:.3f}), "
          f"diff: {diff_pct:.2f}%", file=sys.stderr)

    # Решение: >= 5% — максимальная сумма, < 5% — меньший номер ряда
    if diff_pct >= 5:
        best_row_num = top1_row_num
        print(f"[Decision] diff >= 5%, winner = Row {best_row_num} (highest sum)", file=sys.stderr)
    else:
        best_row_num = min(top1_row_num, top2_row_num)
        print(f"[Decision] diff < 5%, winner = Row {best_row_num} (earlier row)", file=sys.stderr)

    winning_row = rows[best_row_num]

    # Сохраняем diff_pct для отчёта
    winning_row['_diff_pct'] = diff_pct
    winning_row['_top2_row'] = top2_row_num

    print(f"\n[Winner] Row {best_row_num} (Sum: {winning_row['madmom_sum']:.3f}, "
          f"Avg: {winning_row['madmom_avg']:.3f})", file=sys.stderr)

    return best_row_num, winning_row


def determine_offset(winning_row, all_beats):
    """
    Offset = время первого бита победившего ряда.
    НЕ сдвигаем к началу — фаза уже определена через анализ рядов.
    """
    first_beat_idx = winning_row['beat_indices'][0]
    offset = all_beats[first_beat_idx]

    print(f"[Offset] Beat index: {first_beat_idx}, Time: {offset:.3f}s", file=sys.stderr)

    return offset, first_beat_idx


# ==========================================
# OUTPUT GENERATION
# ==========================================

def analyze_energy_patterns(all_beats, beat_energies, winning_row_num, duration, bpm):
    """
    Анализ энергетических паттернов для детекции мостиков и брейков.

    Два набора метрик:
    1. *_full — сравнение со средней ВСЕХ битов
    2. *_strong — сравнение со средней СИЛЬНЫХ рядов (1 и 5)

    Логика:
    1. Отрезаем первые и последние N секунд (из конфига)
    2. Скользящее окно по 4 бита с шагом 1
    3. КАЖДЫЙ из 4 битов сравнивается с эталоном:
       - Bridge: low < ratio < high (из конфига)
       - Break: low < ratio < high (из конфига)
       - Stable: bridge_high <= ratio <= break_low
       - Mixed: остальное (неоднородные окна)
    """
    # Загружаем пороги из конфига
    cfg = load_thresholds_config()
    TRIM_SECONDS = cfg['trim_seconds']
    BRIDGE_LOW = cfg['bridge']['low']
    BRIDGE_HIGH = cfg['bridge']['high']
    BREAK_LOW = cfg['break']['low']
    BREAK_HIGH = cfg['break']['high']
    CONFIRM_BEATS = cfg['confirm_beats']

    print(f"[Energy] Thresholds: Bridge({BRIDGE_LOW}-{BRIDGE_HIGH}), "
          f"Break({BREAK_LOW}-{BREAK_HIGH}), Trim={TRIM_SECONDS}s, "
          f"Confirm={CONFIRM_BEATS} beats", file=sys.stderr)

    # Фильтруем биты в рабочем диапазоне
    end_time = duration - TRIM_SECONDS
    working_beats = [(i, t, e) for i, (t, e) in enumerate(zip(all_beats, beat_energies))
                     if TRIM_SECONDS <= t <= end_time]

    if len(working_beats) < 4:
        return {
            'avg_energy_full': 0,
            'avg_energy_strong': 0,
            'bridges_full': 0, 'breaks_full': 0, 'stable_full': 0, 'mixed_full': 0,
            'bridges_strong': 0, 'breaks_strong': 0, 'stable_strong': 0, 'mixed_strong': 0,
            'bridge_times_full': [], 'break_times_full': [],
            'bridge_times_strong': [], 'break_times_strong': [],
            'analyzed_windows': 0
        }

    # Средняя энергия ВСЕХ битов (Avg Full)
    all_energies = [e for _, _, e in working_beats]
    avg_energy_full = sum(all_energies) / len(all_energies) if all_energies else 0

    # Средняя энергия СИЛЬНЫХ рядов (Avg Strong) — счёт "РАЗ" и "ПЯТЬ"
    strong_row_1 = winning_row_num
    strong_row_5 = ((winning_row_num + 4 - 1) % 8) + 1
    strong_energies = [e for i, _, e in working_beats
                       if ((i % 8) + 1) in (strong_row_1, strong_row_5)]
    avg_energy_strong = sum(strong_energies) / len(strong_energies) if strong_energies else 0

    # Счётчики и списки таймингов для обоих методов
    bridges_full, breaks_full, stable_full, mixed_full = 0, 0, 0, 0
    bridges_strong, breaks_strong, stable_strong, mixed_strong = 0, 0, 0, 0

    # Тайминги первых битов мостиков и брейков (отдельно для full и strong)
    bridge_times_full = []
    break_times_full = []
    bridge_times_strong = []
    break_times_strong = []

    # Скользящее окно по 4 бита с шагом 1
    for window_start in range(len(working_beats) - 3):
        window = working_beats[window_start:window_start + 4]
        window_energies = [e for _, _, e in window]
        first_beat_time = window[0][1]  # время первого бита окна

        # Собираем confirmation beats (N битов после окна)
        confirm_energies = []
        if CONFIRM_BEATS > 0:
            for cb in range(1, CONFIRM_BEATS + 1):
                cb_idx = window_start + 4 + cb - 1
                if cb_idx < len(working_beats):
                    confirm_energies.append(working_beats[cb_idx][2])

        # Классификация по FULL (все биты)
        if avg_energy_full > 0:
            ratios = [e / avg_energy_full for e in window_energies]
            # Bridge: ВСЕ 4 бита в диапазоне (30%, 80%)
            all_bridge = all(BRIDGE_LOW < r < BRIDGE_HIGH for r in ratios)
            # Break: ВСЕ 4 бита в диапазоне (120%, 185%)
            all_break = all(BREAK_LOW < r < BREAK_HIGH for r in ratios)
            # Stable: ВСЕ 4 бита в диапазоне [80%, 120%]
            all_stable = all(BRIDGE_HIGH <= r <= BREAK_LOW for r in ratios)

            # Confirmation: следующие биты подтверждают выход из мостика/брейка
            if all_bridge and CONFIRM_BEATS > 0 and confirm_energies:
                max_window = max(window_energies)
                # Все confirm биты должны быть громче max окна
                if not all(ce > max_window for ce in confirm_energies):
                    all_bridge = False
            if all_break and CONFIRM_BEATS > 0 and confirm_energies:
                min_window = min(window_energies)
                # Все confirm биты должны быть тише min окна
                if not all(ce < min_window for ce in confirm_energies):
                    all_break = False

            if all_bridge:
                bridges_full += 1
                bridge_times_full.append(round(first_beat_time, 2))
            elif all_break:
                breaks_full += 1
                break_times_full.append(round(first_beat_time, 2))
            elif all_stable:
                stable_full += 1
            else:
                mixed_full += 1

        # Классификация по STRONG (сильные ряды)
        if avg_energy_strong > 0:
            ratios = [e / avg_energy_strong for e in window_energies]
            # Bridge: ВСЕ 4 бита в диапазоне (30%, 80%)
            all_bridge = all(BRIDGE_LOW < r < BRIDGE_HIGH for r in ratios)
            # Break: ВСЕ 4 бита в диапазоне (120%, 185%)
            all_break = all(BREAK_LOW < r < BREAK_HIGH for r in ratios)
            # Stable: ВСЕ 4 бита в диапазоне [80%, 120%]
            all_stable = all(BRIDGE_HIGH <= r <= BREAK_LOW for r in ratios)

            # Confirmation: те же проверки для strong метода
            if all_bridge and CONFIRM_BEATS > 0 and confirm_energies:
                max_window = max(window_energies)
                if not all(ce > max_window for ce in confirm_energies):
                    all_bridge = False
            if all_break and CONFIRM_BEATS > 0 and confirm_energies:
                min_window = min(window_energies)
                if not all(ce < min_window for ce in confirm_energies):
                    all_break = False

            if all_bridge:
                bridges_strong += 1
                bridge_times_strong.append(round(first_beat_time, 2))
            elif all_break:
                breaks_strong += 1
                break_times_strong.append(round(first_beat_time, 2))
            elif all_stable:
                stable_strong += 1
            else:
                mixed_strong += 1

    total_windows = bridges_full + breaks_full + stable_full + mixed_full

    return {
        'avg_energy_full': round(avg_energy_full, 4),
        'avg_energy_strong': round(avg_energy_strong, 4),
        'bridges_full': bridges_full,
        'breaks_full': breaks_full,
        'stable_full': stable_full,
        'mixed_full': mixed_full,
        'bridges_strong': bridges_strong,
        'breaks_strong': breaks_strong,
        'stable_strong': stable_strong,
        'mixed_strong': mixed_strong,
        'bridge_times_full': bridge_times_full,
        'break_times_full': break_times_full,
        'bridge_times_strong': bridge_times_strong,
        'break_times_strong': break_times_strong,
        'analyzed_windows': total_windows
    }


def _run_bridge_detector(all_beats, activations, winning_row_num, pair_row,
                         global_diff_pct, num_sections, rnn_fps=100.0):
    """
    Один проход Bridge Detector для заданного количества секций.

    Алгоритм:
    1. Глобально определены winning_row и pair_row (±4)
    2. В каждой секции считаем СРЕДНЕЕ madmom score только для этих двух рядов
    3. Сравниваем: кто доминирует в секции и на сколько %
    4. Если в какой-то секции pair_row > winning_row — мостик есть

    Формат: "Да 8%. 1-5 5%, 2-1 0.2%, 3-5 5%"
    """
    total_beats = len(all_beats)

    if total_beats < num_sections * 8:
        return {
            'has_bridge': False,
            'sections': [],
            'summary': f"Нет. Мало битов ({total_beats})"
        }

    section_size = total_beats // num_sections
    sections_result = []

    print(f"\n  [BD-{num_sections}] {total_beats} beats -> {num_sections} sections "
          f"({section_size} each), Row {winning_row_num} vs Row {pair_row}", file=sys.stderr)

    for s in range(num_sections):
        start_idx = s * section_size
        end_idx = (s + 1) * section_size if s < num_sections - 1 else total_beats

        # Собираем madmom scores только для двух рядов в этой секции
        scores_winner = []
        scores_pair = []

        for idx in range(start_idx, end_idx):
            row_num = (idx % 8) + 1
            beat_time = all_beats[idx]
            frame = int(beat_time * rnn_fps)
            if frame < len(activations):
                score = float(activations[frame, 1])
                if row_num == winning_row_num:
                    scores_winner.append(score)
                elif row_num == pair_row:
                    scores_pair.append(score)

        # Средние (не суммы — для нормализации разного размера секций)
        avg_winner = sum(scores_winner) / len(scores_winner) if scores_winner else 0
        avg_pair = sum(scores_pair) / len(scores_pair) if scores_pair else 0

        # Кто доминирует в этой секции?
        if avg_winner >= avg_pair:
            section_dominant = winning_row_num
            diff = ((avg_winner - avg_pair) / avg_winner * 100) if avg_winner > 0 else 0
        else:
            section_dominant = pair_row
            diff = ((avg_pair - avg_winner) / avg_pair * 100) if avg_pair > 0 else 0

        sections_result.append({
            'section': s + 1,
            'dominant_row': section_dominant,
            'diff_pct': round(diff, 2),
            'avg_winner': round(avg_winner, 4),
            'avg_pair': round(avg_pair, 4)
        })

        print(f"    Section {s + 1}: Row {section_dominant} wins "
              f"(diff={diff:.2f}%, avg_w={avg_winner:.4f}, avg_p={avg_pair:.4f})",
              file=sys.stderr)

    # Мостик = хотя бы в одной секции pair_row доминирует
    has_bridge = any(s['dominant_row'] == pair_row for s in sections_result)

    # Формируем summary: "Да 8%. 1-5 5%, 2-1 0.2%, 3-5 5%"
    parts = [f"{s['section']}-{s['dominant_row']} {s['diff_pct']}%" for s in sections_result]
    prefix = f"Да {global_diff_pct}%" if has_bridge else f"Нет {global_diff_pct}%"
    summary = f"{prefix}. {', '.join(parts)}"

    print(f"    Result: {summary}", file=sys.stderr)

    return {
        'has_bridge': has_bridge,
        'sections': sections_result,
        'summary': summary
    }


def analyze_bridge_detection(all_beats, activations, winning_row_num, diff_pct, rnn_fps=100.0):
    """
    Bridge Detection — тройной анализ (BD-2, BD-3, BD-5).

    Глобально определены winning_row и pair_row (±4).
    Для каждого варианта разбивки (2, 3, 5 секций) сравниваем
    средние madmom scores этих двух рядов внутри каждой секции.
    """
    pair_row = ((winning_row_num + 4 - 1) % 8) + 1
    global_diff_pct = round(diff_pct, 1)

    print(f"\n[Bridge Detection] Global: Row {winning_row_num} vs Row {pair_row}, "
          f"diff={global_diff_pct}%", file=sys.stderr)

    bd2 = _run_bridge_detector(all_beats, activations, winning_row_num, pair_row,
                                global_diff_pct, 2, rnn_fps)
    bd3 = _run_bridge_detector(all_beats, activations, winning_row_num, pair_row,
                                global_diff_pct, 3, rnn_fps)
    bd5 = _run_bridge_detector(all_beats, activations, winning_row_num, pair_row,
                                global_diff_pct, 5, rnn_fps)

    return {
        'winning_row': winning_row_num,
        'pair_row': pair_row,
        'global_diff_pct': global_diff_pct,
        'bd2': bd2,
        'bd3': bd3,
        'bd5': bd5
    }


def generate_output(audio_path, all_beats, rows, winning_row_num, winning_row,
                    offset, start_beat_idx, bpm, duration,
                    activations, y, sr, rnn_fps=100.0):
    """Генерация подробного JSON отчёта (оптимизированная версия)."""

    # 1. META
    meta = {
        'filename': os.path.basename(audio_path),
        'duration': round(duration, 2),
        'sample_rate': sr,
        'total_beats': len(all_beats),
        'avg_bpm': bpm,
        'algorithm': 'correlation-v2.0-smart-rows'
    }

    # 2. VERDICT
    # Получаем diff_pct из winning_row (сохранён в find_winning_row)
    diff_pct = winning_row.get('_diff_pct', 100)
    top2_row = winning_row.get('_top2_row', None)

    # Определяем reason
    sorted_rows_list = sorted(rows.values(), key=lambda x: x['madmom_sum'], reverse=True)
    top_sum = sorted_rows_list[0]['madmom_sum']

    if diff_pct >= 5:
        reason = f"Row {winning_row_num} has highest madmom sum (diff {diff_pct:.1f}%)"
    else:
        reason = f"Row {winning_row_num} wins as earlier row (diff {diff_pct:.1f}% < 5%)"

    verdict = {
        'winning_row': winning_row_num,
        'winning_row_sum': round(winning_row['madmom_sum'], 3),
        'winning_row_avg': round(winning_row['madmom_avg'], 3),
        'diff_percent': round(diff_pct, 2),
        'start_beat_id': start_beat_idx,
        'start_time': round(offset, 3),
        'reason': reason
    }

    # 3. ROW ANALYSIS
    row_analysis = {}
    for row_num, row_data in rows.items():
        row_analysis[f'row_{row_num}'] = {
            'beat_indices': row_data['beat_indices'][:10],
            'beat_indices_full_count': len(row_data['beat_indices']),
            'count': row_data['count'],
            'madmom_sum': round(row_data['madmom_sum'], 3),
            'madmom_avg': round(row_data['madmom_avg'], 3),
            'madmom_max': round(row_data['madmom_max'], 3),
            'madmom_min': round(row_data['madmom_min'], 3)
        }

    # 4. TOP MADMOM BEATS
    beats_with_scores = []
    for i, beat_time in enumerate(all_beats):
        frame = int(beat_time * rnn_fps)
        if frame < len(activations):
            score = float(activations[frame, 1])
            beats_with_scores.append({
                'id': i,
                'time': beat_time,
                'madmom_score': score
            })

    beats_with_scores.sort(key=lambda x: x['madmom_score'], reverse=True)

    top_madmom_beats = []
    if beats_with_scores:
        max_score = beats_with_scores[0]['madmom_score']
        threshold = max_score - 0.05
        top_near_max = [b for b in beats_with_scores if b['madmom_score'] >= threshold]

        for rank, beat in enumerate(top_near_max, 1):
            top_madmom_beats.append({
                'id': beat['id'],
                'time': round(beat['time'], 3),
                'madmom_score': round(beat['madmom_score'], 4),
                'rank': rank
            })

    # 5. ALL BEATS (упрощённая версия — только нужные поля)
    beats_detailed = []
    beat_energies = []  # Для analyze_energy_patterns

    # HPSS: разделяем на гармоническую и перкуссионную части (один раз)
    print("[HPSS] Separating harmonic/percussive...", file=sys.stderr)
    y_harmonic, _ = librosa.effects.hpss(y)
    print(f"[HPSS] Done. Harmonic signal length: {len(y_harmonic)}", file=sys.stderr)

    # --- Librosa frame-level features (computed ONCE) ---
    hop_length = 512
    print("[Librosa] Computing spectral features...", file=sys.stderr)

    lr_spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
    lr_spectral_flatness = librosa.feature.spectral_flatness(y=y, hop_length=hop_length)[0]
    lr_onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    lr_zcr = librosa.feature.zero_crossing_rate(y=y, hop_length=hop_length)[0]
    lr_chroma = librosa.feature.chroma_stft(y=y_harmonic, sr=sr, hop_length=hop_length)

    # Frame times for interpolation
    lr_frame_times = librosa.frames_to_time(
        np.arange(len(lr_spectral_centroid)), sr=sr, hop_length=hop_length
    )
    lr_onset_frame_times = librosa.frames_to_time(
        np.arange(len(lr_onset_env)), sr=sr, hop_length=hop_length
    )

    NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    # Librosa tempo (INFO ONLY — does NOT replace madmom BPM)
    lr_tempo = float(librosa.beat.tempo(y=y, sr=sr, hop_length=hop_length)[0])

    print(f"[Librosa] Done. Frames: {len(lr_spectral_centroid)}, "
          f"Librosa tempo: {lr_tempo:.1f} BPM", file=sys.stderr)

    for i, beat_time in enumerate(all_beats):
        beat_row = (i % 8) + 1

        # Только total energy (остальное не используется в CSV)
        e_total = get_band_energy(y, sr, beat_time, (None, None))
        beat_energies.append(e_total)

        # Madmom score
        frame = int(beat_time * rnn_fps)
        madmom_score = float(activations[frame, 1]) if frame < len(activations) else 0.0

        # Harmonic energy (vocal proxy via HPSS)
        e_harmonic = get_band_energy(y_harmonic, sr, beat_time, (None, None))

        # Librosa per-beat features (interpolated from frame-level)
        sc_val = float(np.interp(beat_time, lr_frame_times, lr_spectral_centroid))
        sf_val = float(np.interp(beat_time, lr_frame_times, lr_spectral_flatness))
        os_val = float(np.interp(beat_time, lr_onset_frame_times, lr_onset_env))
        zcr_val = float(np.interp(beat_time, lr_frame_times, lr_zcr))

        # Chroma: nearest frame argmax → note name
        chroma_frame = min(int(np.round(beat_time * sr / hop_length)), lr_chroma.shape[1] - 1)
        chroma_frame = max(0, chroma_frame)
        note_idx = int(np.argmax(lr_chroma[:, chroma_frame]))
        note_name = NOTE_NAMES[note_idx]
        chroma_strength = float(lr_chroma[note_idx, chroma_frame])

        # Local BPM: from interval to next beat
        if i < len(all_beats) - 1:
            interval = all_beats[i + 1] - beat_time
            local_bpm = round(60.0 / interval, 1) if interval > 0 else 0.0
        else:
            # Last beat: use interval from previous beat
            interval = beat_time - all_beats[i - 1] if i > 0 else 60.0 / bpm
            local_bpm = round(60.0 / interval, 1) if interval > 0 else 0.0

        beats_detailed.append({
            'id': i,
            'time': round(beat_time, 3),
            'row': beat_row,
            'is_start': (i == start_beat_idx),
            'madmom_score': round(madmom_score, 4),
            'energy': round(e_total, 4),
            'harmonic': round(e_harmonic, 4),
            'local_bpm': local_bpm,
            'spectral_centroid': round(sc_val, 1),
            'spectral_flatness': round(sf_val, 4),
            'onset_strength': round(os_val, 4),
            'zcr': round(zcr_val, 4),
            'chroma_note': note_name,
            'chroma_strength': round(chroma_strength, 3),
            'chroma_index': note_idx,
        })

    # 5.1 ENERGY PATTERN ANALYSIS (мостики, брейки)
    energy_analysis = analyze_energy_patterns(
        all_beats, beat_energies, winning_row_num, duration, bpm
    )

    # Добавляем результаты в verdict
    verdict['avg_energy_full'] = energy_analysis['avg_energy_full']
    verdict['avg_energy_strong'] = energy_analysis['avg_energy_strong']
    verdict['bridges_full'] = energy_analysis['bridges_full']
    verdict['breaks_full'] = energy_analysis['breaks_full']
    verdict['stable_full'] = energy_analysis['stable_full']
    verdict['mixed_full'] = energy_analysis['mixed_full']
    verdict['bridges_strong'] = energy_analysis['bridges_strong']
    verdict['breaks_strong'] = energy_analysis['breaks_strong']
    verdict['stable_strong'] = energy_analysis['stable_strong']
    verdict['mixed_strong'] = energy_analysis['mixed_strong']
    verdict['bridge_times_full'] = energy_analysis['bridge_times_full']
    verdict['break_times_full'] = energy_analysis['break_times_full']
    verdict['bridge_times_strong'] = energy_analysis['bridge_times_strong']
    verdict['break_times_strong'] = energy_analysis['break_times_strong']

    # 5.2 BRIDGE DETECTION (тройной секционный анализ: BD-2, BD-3, BD-5)
    bridge_detection = analyze_bridge_detection(all_beats, activations, winning_row_num, diff_pct, rnn_fps)
    verdict['bridge_detection'] = bridge_detection

    # 6. GRID & DOWNBEATS
    beat_interval = 60.0 / bpm
    section_duration = 8 * beat_interval

    grid = []
    current_time = offset
    while current_time > 0:
        current_time -= section_duration
    while current_time < duration:
        end_time = current_time + section_duration
        if end_time > 0:
            start_display = round(max(0, current_time), 3)
            if start_display < 0 and start_display > -0.1:
                start_display = 0.0
            grid.append({
                'type': 'verse',
                'start': start_display,
                'beats': 8
            })
        current_time += section_duration

    downbeats = []
    db_time = offset
    while db_time < duration:
        if db_time >= 0:
            downbeats.append(round(db_time, 3))
        db_time += beat_interval * 4

    # Librosa global summary (INFO ONLY)
    librosa_summary = {
        'librosa_tempo': round(lr_tempo, 1),
        'dominant_key': NOTE_NAMES[int(np.argmax(np.mean(lr_chroma, axis=1)))],
        'spectral_centroid_mean': round(float(np.mean(lr_spectral_centroid)), 1),
        'spectral_centroid_std': round(float(np.std(lr_spectral_centroid)), 1),
        'spectral_flatness_mean': round(float(np.mean(lr_spectral_flatness)), 4),
        'onset_strength_mean': round(float(np.mean(lr_onset_env)), 4),
        'zcr_mean': round(float(np.mean(lr_zcr)), 4),
    }

    return {
        'meta': meta,
        'verdict': verdict,
        'row_analysis': row_analysis,
        'top_madmom_beats': top_madmom_beats,
        'beats': beats_detailed,
        'librosa_summary': librosa_summary,
        'bpm': bpm,
        'offset': round(offset, 3),
        'duration': duration,
        'grid': grid,
        'downbeats': downbeats,
        'totalBeats': len(all_beats)
    }


# ==========================================
# MAIN ANALYSIS
# ==========================================

def analyze_track_with_madmom(audio_path, drums_path=None):
    try:
        # 1. Подготовка
        analysis_audio_path = drums_path if drums_path and os.path.exists(drums_path) else audio_path
        print(f"Using {'DRUMS' if analysis_audio_path == drums_path else 'ORIGINAL'} track", file=sys.stderr)

        y_analysis, sr = librosa.load(analysis_audio_path, sr=None, mono=True)
        if analysis_audio_path != audio_path:
            y_orig, sr_orig = librosa.load(audio_path, sr=None, mono=True)
        else:
            y_orig, sr_orig = y_analysis, sr
        duration = len(y_orig) / sr_orig
        print(f"Analyzing track: {audio_path} ({duration:.1f}s)", file=sys.stderr)

        # 2. Madmom RNN
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        sf.write(tmp_path, y_analysis, sr)

        try:
            print("Step 1: Running RNNDownBeatProcessor...", file=sys.stderr)
            proc = RNNDownBeatProcessor()
            act = proc(tmp_path)

            rnn_fps = 100.0

            print("Step 2: Tracking beats (fps=100)...", file=sys.stderr)
            beat_processor = DBNBeatTrackingProcessor(fps=100)
            beat_times = beat_processor(act[:, 0])
            all_beats = [float(b) for b in beat_times]

        finally:
            try:
                os.unlink(tmp_path)
            except:
                pass

        if not all_beats or len(all_beats) < 8:
            raise Exception(f"Not enough beats detected ({len(all_beats)})")

        # 3. BPM (STRICT MEAN LOGIC — НЕ МЕНЯТЬ!)
        print("Step 3: Calculating Precise BPM (Strict Mean)...", file=sys.stderr)
        try:
            intervals = np.diff(all_beats)
            avg_interval = np.mean(intervals)
            bpm_mean = 60.0 / avg_interval

            # Проверка на удвоение
            tempo_proc = TempoEstimationProcessor(fps=100, min_bpm=60, max_bpm=190)
            tempos = tempo_proc(act)

            if len(tempos) > 0:
                bpm_global = tempos[0][0]
                ratio = bpm_global / bpm_mean

                if 1.8 < ratio < 2.2:
                    print(f"[BPM] Correction: Doubling ({bpm_mean:.2f} -> ~{bpm_global:.2f})", file=sys.stderr)
                    bpm_mean *= 2
                elif 0.4 < ratio < 0.6:
                    print(f"[BPM] Correction: Halving ({bpm_mean:.2f} -> ~{bpm_global:.2f})", file=sys.stderr)
                    bpm_mean /= 2
                else:
                    print(f"[BPM] Keeping Mean: {bpm_mean:.2f}", file=sys.stderr)

            bpm = int(round(bpm_mean))
            print(f"[BPM] Final: {bpm}", file=sys.stderr)

        except Exception as e:
            print(f"[BPM] Warning: calc failed ({e}), using simple mean", file=sys.stderr)
            if len(all_beats) > 1:
                bpm = round(60.0 / np.mean(np.diff(all_beats)))
            else:
                bpm = 120

        # 4. SMART ROW ANALYSIS (НОВАЯ ЛОГИКА v2.0)
        print("\nStep 4: Smart Row Analysis...", file=sys.stderr)
        print(f"Total beats: {len(all_beats)}", file=sys.stderr)

        rows = distribute_beats_to_rows(all_beats)
        rows = calculate_row_scores(rows, all_beats, act, rnn_fps)
        winning_row_num, winning_row = find_winning_row(rows, all_beats, act, rnn_fps)
        offset, start_beat_idx = determine_offset(winning_row, all_beats)

        # 5. Генерация output (HPSS убран — не используется в CSV)
        print("\nStep 5: Generating output...", file=sys.stderr)
        result = generate_output(
            audio_path, all_beats, rows, winning_row_num, winning_row,
            offset, start_beat_idx, bpm, duration,
            act, y_orig, sr_orig, rnn_fps
        )

        print(f"\nDone! BPM={bpm}, Offset={offset:.3f}s, "
              f"Winner=Row {winning_row_num}", file=sys.stderr)

        return result

    except Exception as e:
        import traceback
        print(f"Error in analysis: {str(e)}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        return {'bpm': 120, 'offset': 0.0, 'duration': 180, 'grid': [], 'error': str(e)}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Audio path required'}), file=sys.stderr)
        sys.exit(1)
    audio_path = sys.argv[1]
    drums_path = None
    if len(sys.argv) >= 4 and sys.argv[2] == '--use-drums':
        drums_path = sys.argv[3]
    result = analyze_track_with_madmom(audio_path, drums_path)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
