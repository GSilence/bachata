#!/usr/bin/env python3
"""
Bachata Track Analysis v2
=========================
Алгоритм определения рядов (РАЗ / ПЯТЬ).
Основан на подсчёте доминирования Row 1 над Row 5.

Фазы:
0. Классификация (2 пика = бачата, 4 пика = попса)
1. Вычисление Row 1 и Row 5 (поиск начала, проверка доминирования)
2. Проверка свапа рядов по madmom diff
"""

import sys
import os
import json
import warnings

# Disable Numba JIT caching (causes "no locator available" on some Linux setups)
os.environ.setdefault("NUMBA_DISABLE_JIT", "1")

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
        'popsa_peak_threshold': 0.70,
        'perc_start_threshold': 0.20,   # 20% — порог: средняя по песне ниже среднего такта на N% → такт считаем РАЗ
        'perceptual_window_sec': 0.05,   # окно для perceptual_energy (с). 0.08 = 80ms, 0.20 = 200ms
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


def precompute_mel_spectrogram(y, sr, hop_length=512):
    """Предварительно вычисляет mel spectrogram и mel-частоты для всего трека."""
    mel_spec = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, hop_length=hop_length)
    mel_freqs = librosa.mel_frequencies(n_mels=128, fmin=0.0, fmax=sr / 2.0)
    return mel_spec, hop_length, mel_freqs


def get_perceptual_energy(mel_spec, mel_freqs, sr, hop_length, time_sec, window_sec=0.20):
    """
    A-weighted perceptual energy (кривая Флетчера-Мэнсона).
    Применяет librosa.perceptual_weighting к мел-спектрограмме в окне вокруг бита.
    Возвращает среднее значение в dB с A-взвешиванием.
    """
    fps = sr / hop_length
    center_frame = int(time_sec * fps)
    half_window = max(1, int(window_sec * fps / 2))
    start = max(0, center_frame - half_window)
    end = min(mel_spec.shape[1], center_frame + half_window + 1)
    if start >= end:
        return 0.0
    chunk = mel_spec[:, start:end]
    pw = librosa.perceptual_weighting(chunk, mel_freqs, kind='A')
    val = float(np.mean(pw))
    return val if np.isfinite(val) else 0.0


def log(msg):
    print(msg, file=sys.stderr)


# ==========================================
# ФАЗА 0: Классификация (2 vs 4 пика)
# ==========================================

def classify_peaks(activations, all_beats, rnn_fps):
    """
    Фаза 0: Классификация трека — 2 пика (бачата) или 4 пика (попса).

    Попса: берём 4 самых сильных позиции из 8 в цикле.
           Если слабейший из них >= 70% от сильнейшего (разница < 30%) → попса.
    Бачата: 2 доминирующих пика, разнесённых на ~4 позиции.

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

    # Сортируем все 8 позиций по убыванию
    sorted_positions = sorted(range(8), key=lambda p: avg_scores[p], reverse=True)

    # Берём топ-4 и сравниваем слабейший с сильнейшим
    top4 = sorted_positions[:4]
    top4_scores = [avg_scores[p] for p in top4]
    score_max = top4_scores[0]
    score_4th = top4_scores[3]
    ratio_4th = score_4th / max(score_max, 0.001)

    config = load_config()
    threshold = config['popsa_peak_threshold']  # 0.70 = разница < 30%

    log(f"[Phase 0] Top-4 positions: {top4}, scores: {[f'{s:.3f}' for s in top4_scores]}")
    log(f"[Phase 0] Ratio 4th/1st = {ratio_4th:.3f}, threshold = {threshold}")

    if ratio_4th >= threshold:
        # Все 4 сильных пика примерно равны → попса
        peak1_pos = sorted_positions[0]
        peak2_pos = sorted_positions[1]
        log("[Phase 0] Result: 4 peaks (POPSA)")
        return 4, peak1_pos, peak2_pos

    # 2 доминирующих пика — стандартная бачата
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
    log("[Phase 0] Result: 2 peaks (standard bachata)")
    return 2, peak1_pos, peak2_pos


# ==========================================
# ФАЗА 1: Вычисление Row 1 и Row 5
# ==========================================

def compute_beat_data(all_beats, activations, rnn_fps, y, sr, mel_spec=None, mel_hop=512, mel_freqs=None, perc_window_sec=None):
    """Вычисляет energy, perceptual_energy и madmom_score для каждого бита."""
    if perc_window_sec is None:
        perc_window_sec = 0.20
    window_sec = 0.08
    beats = []
    for i, beat_time in enumerate(all_beats):
        # RMS энергия в окне вокруг бита (полный спектр)
        half_window = int((window_sec * sr) / 2)
        center_sample = int(beat_time * sr)
        start = max(0, center_sample - half_window)
        end = min(len(y), center_sample + half_window)
        energy = float(np.sqrt(np.mean(y[start:end] ** 2))) if start < end else 0.0
        perc_e = get_perceptual_energy(mel_spec, mel_freqs, sr, mel_hop, beat_time, window_sec=perc_window_sec) if (mel_spec is not None and mel_freqs is not None) else 0.0
        frame = min(int(beat_time * rnn_fps), len(activations) - 1)
        madmom_score = float(activations[frame, 1]) if activations.ndim > 1 else float(activations[frame])
        beats.append({
            'id': i,
            'time': beat_time,
            'energy': energy,
            'perceptual_energy': perc_e,
            'madmom_score': madmom_score,
        })
    return beats


def build_strong_rows_tact_table(beats, peak1_pos, peak2_pos):
    """
    Строим таблицу тактов для сильных рядов (peak1 и peak2).
    Для каждого бита сильного ряда: такт = этот бит + следующие 3.
    tact_sum = сумма perceptual_energy 4 битов (dB), tact_avg = tact_sum / 4.
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
        tact_sum = sum(beats[j].get('perceptual_energy', 0.0) for j in range(i, i + 4))
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



def find_song_start_perc(beats, peak1_pos, peak2_pos, config):
    """
    Фаза 1: ищем РАЗ по таблице «Такты сильных рядов» (perceptual).

    Алгоритм:
      1. Таблица тактов: для каждого такта сильного ряда — те же tact_sum/tact_avg (для вывода).
      2. Среднее perceptual по всей песне → mean_perc.
      3. Идём по тактам по очереди: 1-й такт ряда 1, 1-й ряда 5, 2-й ряда 1, …
      4. В каждом такте смотрим биты по порядку. Первый бит (по всему треку), у которого
         perceptual_energy > mean_perc, определяет такт: начало этого такта = РАЗ.

    Возвращает: (start_idx, strong_rows_tact_list, strong_rows_tact_by_row)
    """
    table_list, table_by_row = build_strong_rows_tact_table(beats, peak1_pos, peak2_pos)

    perc_values = [b.get('perceptual_energy', 0.0) for b in beats]
    has_perc = any(v != 0.0 for v in perc_values)
    if not has_perc:
        log("[Phase 1] perceptual_energy недоступна — fallback beat 0")
        return 0, table_list, table_by_row

    mean_perc = float(np.mean(perc_values))
    log(f"[Phase 1] Perc mean (вся песня): {mean_perc:.2f} dB — ищем первый бит выше среднего в тактах сильных рядов")
    if table_list:
        log(f"[Phase 1] Такты сильных рядов: {len(table_list)} тактов, первые: "
            f"row={table_list[0]['row_position']} beat={table_list[0]['beat']}, "
            f"row={table_list[1]['row_position']} beat={table_list[1]['beat']}")

    # Порядок: 1-й такт peak1, 1-й peak2, 2-й peak1, 2-й peak2, …
    # Последний бит такта (j=3) не считаем РАЗ — скорее косяк исполнения, идём дальше.
    for row in table_list:
        tact_start = row['beat']
        for j in range(3):  # только биты 0, 1, 2 — не последний (3) в такте
            bi = tact_start + j
            if bi >= len(beats):
                break
            pe = beats[bi].get('perceptual_energy', 0.0)
            if pe > mean_perc:
                log(f"[Phase 1] РАЗ найден: первый бит выше среднего (не последний в такте) — beat {bi} (time {beats[bi]['time']:.2f}s), "
                    f"perceptual_energy={pe:.2f} > mean {mean_perc:.2f} dB, row_pos={row['row_position']}, такт с beat {tact_start}")
                return tact_start, table_list, table_by_row

    log("[Phase 1] Нет бита выше среднего в тактах сильных рядов (или только на последнем бите такта) — используем beat 0")
    return 0, table_list, table_by_row



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
    log("Precomputing mel spectrogram...")
    mel_spec, mel_hop, mel_freqs = precompute_mel_spectrogram(y, sr)
    perc_window = config.get('perceptual_window_sec', 0.20)
    log(f"Perceptual window: {perc_window*1000:.0f} ms")
    beats = compute_beat_data(all_beats, activations, rnn_fps, y, sr, mel_spec, mel_hop, mel_freqs, perc_window_sec=perc_window)

    # --- local_bpm: локальный темп по интервалам между битами ---
    for i in range(len(beats)):
        if i < len(beats) - 1:
            interval = beats[i + 1]['time'] - beats[i]['time']
            beats[i]['local_bpm'] = round(60.0 / interval, 1) if interval > 0 else float(bpm)
        else:
            beats[i]['local_bpm'] = beats[max(0, i - 1)].get('local_bpm', float(bpm))

    # === ФАЗА 0: Классификация ===
    peaks, peak1_pos, peak2_pos = classify_peaks(activations, all_beats, rnn_fps)
    log(f"[Phase 0] Peak positions in 8-beat cycle: {peak1_pos}, {peak2_pos}")

    # === ПОПСА: ранний выход → перенаправляем в analyze-popsa.py ===
    if peaks == 4:
        log("[Phase 0] Popsa detected → redirecting to analyze-popsa.py")
        return {'success': True, 'popsa_redirect': True}

    # === ФАЗА 1: РАЗ по perceptual_energy (только для 2-пиковых треков) ===
    start_idx, _, _ = find_song_start_perc(
        beats, peak1_pos, peak2_pos, config
    )
    row_swapped = False

    # Натягиваем сетку на начало трека кратно 8 битам (без остатка)
    shift_back = (start_idx // 8) * 8
    if shift_back > 0:
        start_idx -= shift_back
        log(f"[Phase 1] Shift back {shift_back} beats → start_idx={start_idx} ({beats[start_idx]['time']:.2f}s)")
    log(f"[Phase 1] Final РАЗ: beat {start_idx} ({beats[start_idx]['time']:.2f}s)")

    # === Row Analysis — первым делом, нужен для ранней проверки мадмом ===
    row_analysis, row_analysis_verdict = compute_row_analysis(
        beats, start_idx, peak1_pos, peak2_pos
    )
    # РАЗ-ряд и ПЯТЬ-ряд по madmom
    _row_one = row_analysis_verdict['row_one']           # номер ряда РАЗ (1-8)
    _peak_rows = row_analysis_verdict['winning_rows']    # [peak1_row, peak2_row]
    _row_five = _peak_rows[1] if _row_one == _peak_rows[0] else _peak_rows[0]
    _m1 = row_analysis.get(f'row_{_row_one}', {}).get('madmom_sum', 0.0)
    _m5 = row_analysis.get(f'row_{_row_five}', {}).get('madmom_sum', 0.0)
    madmom_diff_pct = round((_m1 - _m5) / abs(_m5) * 100, 2) if _m5 != 0 else 0.0
    log(f"[Phase 2] Мадмом РАЗ={_m1:.3f}, ПЯТЬ={_m5:.3f}, diff={madmom_diff_pct:.2f}%")

    rounded_diff = round(madmom_diff_pct, 1)

    if rounded_diff <= -5.0:
        # ПЯТЬ явно доминирует ≤-5% → наше "РАЗ" оказалось ПЯТЬ → свопаем ряды
        row_swapped = True
        true_row_one = _row_five
        true_row_five = _row_one
        row_analysis_verdict['row_one'] = true_row_one
        madmom_diff_pct = round((_m5 - _m1) / abs(_m1) * 100, 2) if _m1 != 0 else 0.0
        start_idx = (start_idx + 4) % 8
        log(f"[Phase 2] Мадмом diff={rounded_diff}%≤-5% → ПЯТЬ доминирует, свопаем ряды")
        log(f"[Phase 2] Новый РАЗ = ряд {true_row_one} (мадмом {_m5:.3f}), новый ПЯТЬ = ряд {true_row_five} (мадмом {_m1:.3f}), новый diff={madmom_diff_pct:.2f}%")
        log(f"[Phase 2] Новый start_idx={start_idx} ({beats[start_idx]['time']:.2f}s)")
    else:
        log(f"[Phase 2] Мадмом diff={rounded_diff}% → квадрат, ряды подтверждены")

    # Мостики не ищем — всегда квадратная сетка

    # Счёт битов с 1 в выходном JSON (внутри скрипта везде 0-based)
    def beat1(x):
        return x + 1

    perc_values = [b.get('perceptual_energy', 0.0) for b in beats]
    perc_mean = float(np.mean(perc_values)) if perc_values else 0.0
    perc_mean_minus_30 = perc_mean * (1.0 - 0.30)

    result = {
        'success': True,
        'version': 'v2',
        'track_type': 'bachata',
        'peaks_per_octave': 2,
        'bpm': bpm,
        'duration': round(duration, 2),
        'song_start_beat': beat1(start_idx),
        'song_start_time': round(beats[start_idx]['time'], 2),
        'row_swapped': row_swapped,
        'perceptual_energy_mean': round(perc_mean, 4),
        'perceptual_energy_mean_minus_30': round(perc_mean_minus_30, 4),
        'row_analysis': row_analysis,
        'row_analysis_verdict': {**row_analysis_verdict, 'start_beat_id': beat1(start_idx)},
        'madmom_diff_pct': madmom_diff_pct,
        # Мостики не ищем — всегда квадратная сетка
        'layout': [],
        'layout_perc': [],
        'beat_base': 1,
        'per_beat_data': [{'id': beat1(b['id']), 'time': round(b['time'], 3),
                           'energy': round(b['energy'], 4),
                           'perceptual_energy': round(b.get('perceptual_energy', 0.0), 4),
                           'madmom_score': round(b['madmom_score'], 4),
                           'local_bpm': round(b.get('local_bpm', 0.0), 1)}
                          for b in beats],
    }

    log(f"\n=== RESULT ===")
    log(f"Type: {result['track_type']}")
    log(f"Start: beat {start_idx} ({beats[start_idx]['time']:.2f}s){' [SWAPPED]' if row_swapped else ''}")
    log(f"Row swapped: {row_swapped}")
    log(f"Madmom diff: {madmom_diff_pct:.2f}%")

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
