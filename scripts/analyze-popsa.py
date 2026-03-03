#!/usr/bin/env python3
"""
Popsa Track Analyzer
====================
Анализатор для 4-пиковых треков (попса / не-бачата).

Алгоритм:
  1. Madmom beat detection + BPM
  2. Фаза 0: Классификация (confirm 4 peaks)
  3. Находим сильные позиции (все 4 пика в 8-цикле, каждые 2 бита)
  4. Ищем первый бит выше среднего perceptual_energy на сильной позиции — это RAZ
  5. Натягиваем сетку: один сегмент от RAZ до конца, row1_start=1

Принцип такой же, как в analyze-track-v2.py для бачаты:
  - Madmom даёт биты и activations
  - Perceptual energy определяет, где реальное начало трека (RAZ)
  - Сетка 1-8 накладывается на первый заметный пик
"""

import sys
import os
import json
import warnings

# --- CRITICAL PATCHES (same as v2) ---
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
# CONFIG & HELPERS (copied from v2)
# ==========================================

def load_config():
    config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config', 'analysis-thresholds.json')
    defaults = {
        'popsa_peak_threshold': 0.70,
        'perceptual_window_sec': 0.20,
    }
    try:
        with open(config_path, 'r') as f:
            cfg = json.load(f)
        return {**defaults, **cfg}
    except Exception as e:
        log(f"[Config] Failed: {e}, using defaults", )
        return defaults


def log(msg):
    print(msg, file=sys.stderr)


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


def precompute_mel_spectrogram(y, sr, hop_length=512):
    """Предварительно вычисляет mel spectrogram и mel-частоты для всего трека."""
    mel_spec = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=128, hop_length=hop_length)
    mel_freqs = librosa.mel_frequencies(n_mels=128, fmin=0.0, fmax=sr / 2.0)
    return mel_spec, hop_length, mel_freqs


def get_perceptual_energy(mel_spec, mel_freqs, sr, hop_length, time_sec, window_sec=0.20):
    """A-weighted perceptual energy (кривая Флетчера-Мэнсона)."""
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


def compute_beat_data(all_beats, activations, rnn_fps, y, sr, mel_spec, mel_hop, mel_freqs, perc_window_sec=0.20):
    """Вычисляет energy, perceptual_energy и madmom_score для каждого бита."""
    beats = []
    for i, beat_time in enumerate(all_beats):
        energy = get_band_energy(y, sr, beat_time)
        perc_e = get_perceptual_energy(mel_spec, mel_freqs, sr, mel_hop, beat_time, window_sec=perc_window_sec)
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


# ==========================================
# ФАЗА 0: Классификация
# ==========================================

def classify_peaks(activations, all_beats, rnn_fps):
    """
    Классификация трека — 2 пика (бачата) или 4 пика (попса).
    Возвращает (peak_count, peak1_pos, peak2_pos, avg_scores).
    """
    position_scores = [[] for _ in range(8)]
    for i, beat_time in enumerate(all_beats):
        pos = i % 8
        frame = min(int(beat_time * rnn_fps), len(activations) - 1)
        score = float(activations[frame, 1]) if activations.ndim > 1 else float(activations[frame])
        position_scores[pos].append(score)

    avg_scores = [np.mean(s) if s else 0.0 for s in position_scores]
    log(f"[Phase 0] Avg madmom by position (0-7): {[f'{v:.3f}' for v in avg_scores]}")

    sorted_positions = sorted(range(8), key=lambda p: avg_scores[p], reverse=True)
    top4 = sorted_positions[:4]
    top4_scores = [avg_scores[p] for p in top4]
    score_max = top4_scores[0]
    score_4th = top4_scores[3]
    ratio_4th = score_4th / max(score_max, 0.001)

    config = load_config()
    threshold = config['popsa_peak_threshold']

    log(f"[Phase 0] Top-4 positions: {top4}, scores: {[f'{s:.3f}' for s in top4_scores]}")
    log(f"[Phase 0] Ratio 4th/1st = {ratio_4th:.3f}, threshold = {threshold}")

    if ratio_4th >= threshold:
        log("[Phase 0] Result: 4 peaks (POPSA)")
        return 4, sorted_positions[0], sorted_positions[1], avg_scores

    log("[Phase 0] Result: 2 peaks — unexpected for popsa analyzer")
    return 2, sorted_positions[0], sorted_positions[1], avg_scores


# ==========================================
# ПОПСА: Поиск начала трека (RAZ)
# ==========================================

def find_popsa_start(beats, peak1_pos):
    """
    RAZ для попсы = первый бит на сильной позиции с madmom выше среднего.

    Сильные позиции: peak1_pos, +2, +4, +6 (все 4 пика в 8-цикле).
    Это гарантирует, что и RAZ (бит 1) и ПЯТЬ (бит 5) всегда будут
    попадать на одинаково сильные доли на протяжении всего трека.
    """
    strong_positions = {(peak1_pos + i * 2) % 8 for i in range(4)}
    log(f"[Popsa] Strong positions in 8-cycle: {sorted(strong_positions)}")

    avg_madmom = float(np.mean([b['madmom_score'] for b in beats]))
    log(f"[Popsa] Mean madmom: {avg_madmom:.3f}")

    for i, b in enumerate(beats):
        if (i % 8) in strong_positions and b['madmom_score'] >= avg_madmom:
            log(f"[Popsa] RAZ: beat {i} (pos {i % 8}) time={b['time']:.2f}s "
                f"madmom={b['madmom_score']:.3f} >= mean {avg_madmom:.3f}")
            return i

    # Fallback: первый бит на сильной позиции без порога
    for i, b in enumerate(beats):
        if (i % 8) in strong_positions:
            log(f"[Popsa] RAZ fallback (first strong pos): beat {i}")
            return i

    log("[Popsa] RAZ not found, using beat 0")
    return 0


# ==========================================
# ПОПСА: Построение layout
# ==========================================

def build_popsa_layout(beats, start_idx):
    """
    Раскладка для 4-пикового трека: один сегмент от start_idx до конца трека.
    row1_start=1 (RAZ = первый бит сетки). Сетка 1-8 без мостиков.

    Для попсы это правильно: все 4 сильных пика равно сильны,
    RAZ (бит 1) и ПЯТЬ (бит 5) оба попадают на пики каждые 2 бита.
    """
    if start_idx >= len(beats):
        return []
    last_idx = len(beats) - 1
    return [{
        'from_beat': start_idx,
        'to_beat': last_idx,
        'time_start': beats[start_idx]['time'],
        'time_end': beats[last_idx]['time'],
        'row1_start': 1,
    }]


# ==========================================
# ГЛАВНЫЙ АНАЛИЗ
# ==========================================

def analyze_popsa_track(audio_path):
    config = load_config()

    # --- Загрузка аудио ---
    log(f"[Popsa] Loading audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    duration = len(y) / sr
    log(f"[Popsa] Duration: {duration:.1f}s, SR: {sr}")

    # --- Madmom RNN ---
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        tmp_path = tmp.name
    sf.write(tmp_path, y, sr)

    try:
        log("[Popsa] Running RNNDownBeatProcessor...")
        proc = RNNDownBeatProcessor()
        activations = proc(tmp_path)
        rnn_fps = 100.0

        log("[Popsa] Tracking beats...")
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
    log("[Popsa] Calculating BPM...")
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
    log(f"[Popsa] BPM: {bpm}")

    # --- Побитовые данные (energy + perceptual + madmom) ---
    log("[Popsa] Precomputing mel spectrogram...")
    mel_spec, mel_hop, mel_freqs = precompute_mel_spectrogram(y, sr)
    perc_window = config.get('perceptual_window_sec', 0.20)
    beats = compute_beat_data(all_beats, activations, rnn_fps, y, sr, mel_spec, mel_hop, mel_freqs, perc_window_sec=perc_window)

    # local_bpm
    for i in range(len(beats)):
        if i < len(beats) - 1:
            interval = beats[i + 1]['time'] - beats[i]['time']
            beats[i]['local_bpm'] = round(60.0 / interval, 1) if interval > 0 else float(bpm)
        else:
            beats[i]['local_bpm'] = beats[max(0, i - 1)].get('local_bpm', float(bpm))

    # --- Фаза 0: Классификация ---
    peaks, peak1_pos, peak2_pos, avg_scores = classify_peaks(activations, all_beats, rnn_fps)
    log(f"[Popsa] Classification: {peaks} peaks, peak1_pos={peak1_pos}")

    if peaks != 4:
        log("[Popsa] WARNING: track not classified as 4-peak — proceeding anyway")

    # --- Поиск RAZ (начала трека) ---
    start_idx = find_popsa_start(beats, peak1_pos)

    # --- Сетка ---
    layout = build_popsa_layout(beats, start_idx)

    strong_positions = {(peak1_pos + i * 2) % 8 for i in range(4)}
    log(f"[Popsa] Grid from beat {start_idx} ({beats[start_idx]['time']:.2f}s), "
        f"strong positions: {sorted(strong_positions)}")

    log(f"[Popsa] Done: BPM={bpm}, start={beats[start_idx]['time']:.2f}s, beats={len(beats)}")

    # --- Row analysis (идентичная структура v2) ---
    row_analysis = {}
    for row_num in range(1, 9):
        row_scores = [beats[i]['madmom_score'] for i in range(len(beats)) if i % 8 == row_num - 1]
        if not row_scores:
            row_analysis[f'row_{row_num}'] = {
                'count': 0, 'madmom_sum': 0.0, 'madmom_avg': 0.0,
                'madmom_max': 0.0, 'madmom_min': 0.0,
            }
        else:
            row_analysis[f'row_{row_num}'] = {
                'count': len(row_scores),
                'madmom_sum': round(float(np.sum(row_scores)), 3),
                'madmom_avg': round(float(np.mean(row_scores)), 3),
                'madmom_max': round(float(np.max(row_scores)), 3),
                'madmom_min': round(float(np.min(row_scores)), 3),
            }
    row_one = (start_idx % 8) + 1
    row_analysis_verdict = {
        'row_one': row_one,
        'winning_rows': sorted([((peak1_pos + i * 2) % 8) + 1 for i in range(4)]),
        'winning_row': row_one,
        'start_beat_id': start_idx,
        'start_time': round(beats[start_idx]['time'], 3),
        'reason': 'popsa: 4 peak rows',
    }

    return {
        'success': True,
        'version': 'popsa-v1',
        'track_type': 'popsa',
        'peaks_per_octave': 4,
        'bpm': bpm,
        'duration': round(duration, 2),
        'song_start_beat': start_idx + 1,
        'song_start_time': round(beats[start_idx]['time'], 2),
        'layout': [{'from_beat': s['from_beat'] + 1, 'to_beat': s['to_beat'] + 1,
                    'time_start': s['time_start'], 'time_end': s['time_end'],
                    'row1_start': s['row1_start']} for s in layout],
        'layout_perc': [],
        'bridges': [],
        'square_analysis': {'parts': {}, 'verdict': 'popsa'},
        'row_analysis': row_analysis,
        'row_analysis_verdict': row_analysis_verdict,
        'per_beat_data': [{'id': b['id'] + 1, 'time': round(b['time'], 3),
                           'energy': round(b['energy'], 4),
                           'perceptual_energy': round(b.get('perceptual_energy', 0.0), 4),
                           'madmom_score': round(b['madmom_score'], 4),
                           'local_bpm': round(b.get('local_bpm', 0.0), 1)}
                          for b in beats],
    }


# ==========================================
# ENTRY POINT
# ==========================================

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: analyze-popsa.py <audio_path>'}))
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(json.dumps({'success': False, 'error': f'File not found: {audio_path}'}))
        sys.exit(1)

    result = analyze_popsa_track(audio_path)
    print(json.dumps(result, ensure_ascii=False))
