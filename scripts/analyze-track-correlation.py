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


def get_spectral_features(y, sr, time_sec, window_sec=0.1):
    """Спектральные фичи: flatness, rolloff, zero crossing rate"""
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)

    if start >= end:
        return 0.0, 0.0, 0.0

    chunk = y[start:end]
    n_fft = min(1024, len(chunk))
    if n_fft == 0:
        return 0.0, 0.0, 0.0

    flat = float(np.mean(librosa.feature.spectral_flatness(y=chunk, n_fft=n_fft)))
    rolloff = float(np.mean(librosa.feature.spectral_rolloff(y=chunk, sr=sr, n_fft=n_fft, roll_percent=0.85)))
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(chunk)))

    return flat, rolloff, zcr


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


def find_winning_row(rows):
    """Находит ряд с максимальной суммой madmom scores."""
    best_row_num = None
    best_sum = -1.0

    for row_num, row_data in rows.items():
        if row_data['madmom_sum'] > best_sum:
            best_sum = row_data['madmom_sum']
            best_row_num = row_num

    winning_row = rows[best_row_num]

    print(f"\n[Winner] Row {best_row_num} (Sum: {best_sum:.3f}, "
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

def generate_output(audio_path, all_beats, rows, winning_row_num, winning_row,
                    offset, start_beat_idx, bpm, duration,
                    activations, y, sr, y_harm, y_perc, rnn_fps=100.0):
    """Генерация подробного JSON отчёта."""

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
    verdict = {
        'winning_row': winning_row_num,
        'winning_row_sum': round(winning_row['madmom_sum'], 3),
        'winning_row_avg': round(winning_row['madmom_avg'], 3),
        'start_beat_id': start_beat_idx,
        'start_time': round(offset, 3),
        'reason': f"Row {winning_row_num} has highest madmom sum"
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

    # 5. ALL BEATS (подробно)
    beats_detailed = []
    for i, beat_time in enumerate(all_beats):
        beat_row = (i % 8) + 1

        # Energy bands
        e_low = get_band_energy(y, sr, beat_time, (None, 200))
        e_mid = get_band_energy(y, sr, beat_time, (200, 2000))
        e_high = get_band_energy(y, sr, beat_time, (4000, None))
        e_total = get_band_energy(y, sr, beat_time, (None, None))

        # HPSS energy
        e_harm = get_band_energy(y_harm, sr, beat_time, (None, None))
        e_perc = get_band_energy(y_perc, sr, beat_time, (None, None))

        # Spectral features
        flat, rolloff, zcr = get_spectral_features(y, sr, beat_time)

        # Madmom score
        frame = int(beat_time * rnn_fps)
        madmom_score = float(activations[frame, 1]) if frame < len(activations) else 0.0

        # Timing
        delta = 0.0
        local_bpm = 0
        if i > 0:
            delta = beat_time - all_beats[i - 1]
            local_bpm = int(60.0 / delta) if delta > 0 else 0

        beats_detailed.append({
            'id': i,
            'time': round(beat_time, 3),
            'row': beat_row,
            'is_start': (i == start_beat_idx),
            'madmom_score': round(madmom_score, 4),
            'energy_stats': {
                'low': round(e_low, 3),
                'mid': round(e_mid, 3),
                'high': round(e_high, 3),
                'total': round(e_total, 3),
                'flatness': round(flat, 4),
                'rolloff': round(rolloff, 3),
                'zcr': round(zcr, 3)
            },
            'decomposition': {
                'harmonic': round(e_harm, 3),
                'percussive': round(e_perc, 3),
                'perc_harm_ratio': round(e_perc / (e_harm + 0.0001), 2)
            },
            'timing': {
                'delta': round(delta, 3),
                'bpm': local_bpm
            }
        })

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
        winning_row_num, winning_row = find_winning_row(rows)
        offset, start_beat_idx = determine_offset(winning_row, all_beats)

        # 5. HPSS (один раз для всего трека, используется в generate_output)
        print("\nStep 5: HPSS decomposition...", file=sys.stderr)
        y_harm, y_perc = librosa.effects.hpss(y_orig, margin=1.0)

        # 6. Генерация подробного output
        print("Step 6: Generating output...", file=sys.stderr)
        result = generate_output(
            audio_path, all_beats, rows, winning_row_num, winning_row,
            offset, start_beat_idx, bpm, duration,
            act, y_orig, sr_orig, y_harm, y_perc, rnn_fps
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
