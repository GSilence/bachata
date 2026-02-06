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

    Логика:
    1. Отрезаем первые и последние 15 секунд
    2. Находим первый бит "РАЗ" после 15с (синхронизация с сеткой)
    3. Считаем среднюю энергию всех битов и битов в сильных рядах (1 и 5)
    4. Проходим по полутактам (4 бита) и классифицируем:
       - bridge: энергия < 80% от средней
       - break: энергия > 120% от средней
       - stable: в пределах ±20%
    """
    TRIM_SECONDS = 15.0
    BRIDGE_THRESHOLD = 0.80  # < 80% = мостик
    BREAK_THRESHOLD = 1.20   # > 120% = брейк

    # Фильтруем биты в рабочем диапазоне
    end_time = duration - TRIM_SECONDS
    working_beats = [(i, t, e) for i, (t, e) in enumerate(zip(all_beats, beat_energies))
                     if TRIM_SECONDS <= t <= end_time]

    if len(working_beats) < 8:
        return {
            'avg_energy_all': 0,
            'avg_energy_strong_rows': 0,
            'potential_bridges': 0,
            'potential_breaks': 0,
            'stable_sections': 0,
            'analyzed_half_bars': 0
        }

    # Средняя энергия всех битов
    all_energies = [e for _, _, e in working_beats]
    avg_energy_all = sum(all_energies) / len(all_energies) if all_energies else 0

    # Средняя энергия сильных рядов (1 и 5 — счёт "РАЗ" и "ПЯТЬ")
    # Row 1 = winning_row, Row 5 = (winning_row + 4 - 1) % 8 + 1
    strong_row_1 = winning_row_num
    strong_row_5 = ((winning_row_num + 4 - 1) % 8) + 1
    strong_energies = [e for i, _, e in working_beats
                       if ((i % 8) + 1) in (strong_row_1, strong_row_5)]
    avg_energy_strong = sum(strong_energies) / len(strong_energies) if strong_energies else 0

    # Находим первый бит "РАЗ" после 15с для синхронизации
    first_raz_idx = None
    for i, t, e in working_beats:
        if (i % 8) + 1 == winning_row_num:
            first_raz_idx = i
            break

    if first_raz_idx is None:
        first_raz_idx = working_beats[0][0] if working_beats else 0

    # Анализируем полутакты (по 4 бита)
    bridges = 0
    breaks = 0
    stable = 0

    # Идём по 4 бита начиная с первого РАЗ
    beat_idx = first_raz_idx
    while beat_idx + 3 < len(all_beats):
        # Проверяем, что все 4 бита в рабочем диапазоне
        bar_times = [all_beats[beat_idx + j] for j in range(4)]
        if bar_times[0] < TRIM_SECONDS or bar_times[3] > end_time:
            beat_idx += 4
            continue

        # Средняя энергия полутакта
        bar_energies = [beat_energies[beat_idx + j] for j in range(4)
                        if beat_idx + j < len(beat_energies)]
        if len(bar_energies) < 4:
            beat_idx += 4
            continue

        bar_avg = sum(bar_energies) / len(bar_energies)

        # Классификация
        if avg_energy_all > 0:
            ratio = bar_avg / avg_energy_all
            if ratio < BRIDGE_THRESHOLD:
                bridges += 1
            elif ratio > BREAK_THRESHOLD:
                breaks += 1
            else:
                stable += 1

        beat_idx += 4

    return {
        'avg_energy_all': round(avg_energy_all, 4),
        'avg_energy_strong_rows': round(avg_energy_strong, 4),
        'potential_bridges': bridges,
        'potential_breaks': breaks,
        'stable_sections': stable,
        'analyzed_half_bars': bridges + breaks + stable
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

    for i, beat_time in enumerate(all_beats):
        beat_row = (i % 8) + 1

        # Только total energy (остальное не используется в CSV)
        e_total = get_band_energy(y, sr, beat_time, (None, None))
        beat_energies.append(e_total)

        # Madmom score
        frame = int(beat_time * rnn_fps)
        madmom_score = float(activations[frame, 1]) if frame < len(activations) else 0.0

        beats_detailed.append({
            'id': i,
            'time': round(beat_time, 3),
            'row': beat_row,
            'is_start': (i == start_beat_idx),
            'madmom_score': round(madmom_score, 4),
            'energy': round(e_total, 4)
        })

    # 5.1 ENERGY PATTERN ANALYSIS (мостики, брейки)
    energy_analysis = analyze_energy_patterns(
        all_beats, beat_energies, winning_row_num, duration, bpm
    )

    # Добавляем результаты в verdict
    verdict['avg_energy_all'] = energy_analysis['avg_energy_all']
    verdict['avg_energy_strong_rows'] = energy_analysis['avg_energy_strong_rows']
    verdict['potential_bridges'] = energy_analysis['potential_bridges']
    verdict['potential_breaks'] = energy_analysis['potential_breaks']
    verdict['stable_sections'] = energy_analysis['stable_sections']

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

    return {
        'meta': meta,
        'verdict': verdict,
        'row_analysis': row_analysis,
        'top_madmom_beats': top_madmom_beats,
        'beats': beats_detailed,
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
