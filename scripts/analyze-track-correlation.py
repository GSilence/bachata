#!/usr/bin/env python3
"""
Корреляционный анализ ритма с использованием Madmom.
=====================================================
Вместо поиска якоря и отступа назад (как basic/extended),
пробует все 8 возможных фазовых смещений и выбирает то,
при котором сетка наилучшим образом совпадает с вероятностями
сильных долей Madmom по ВСЕМУ треку.

Алгоритм:
1. BPM: STRICT MEAN (как в других анализаторах)
2. Offset: Brute-force корреляция по 8 фазам
3. Grid: На основе лучшей фазы
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
# CORRELATION PHASE SCORING
# ==========================================

def find_best_phase(all_beats, activations, rnn_fps=100.0):
    """
    Пробует все 8 фазовых смещений (0..7) и для каждого считает
    суммарную корреляцию с вероятностями сильных долей Madmom.

    Для фазы phase:
    - Биты с индексами phase, phase+8, phase+16, ... → "счёт 1" (вес 1.0)
    - Биты с индексами phase+4, phase+12, phase+20, ... → "счёт 5" (вес 0.8)

    Возвращает (best_phase, best_score, all_scores).
    """
    n = len(all_beats)
    best_phase = 0
    best_score = -1.0
    all_scores = []

    for phase in range(min(8, n)):
        score = 0.0
        count = 0

        # Проходим по всем "счётам 1" для этой фазы
        idx = phase
        while idx < n:
            # Это позиция "счёт 1"
            frame = int(all_beats[idx] * rnn_fps)
            if frame < len(activations):
                score += float(activations[frame, 1])  # downbeat probability
            count += 1

            # "Счёт 5" = +4 бита
            idx5 = idx + 4
            if idx5 < n:
                frame5 = int(all_beats[idx5] * rnn_fps)
                if frame5 < len(activations):
                    score += 0.8 * float(activations[frame5, 1])

            idx += 8  # следующая фраза

        all_scores.append(round(score, 3))
        print(f"[Correlation] Phase {phase}: score={score:.3f} (phrases={count})", file=sys.stderr)

        if score > best_score:
            best_score = score
            best_phase = phase

    print(f"[Correlation] Best phase: {best_phase} (score={best_score:.3f})", file=sys.stderr)
    print(f"[Correlation] All scores: {all_scores}", file=sys.stderr)

    return best_phase, best_score, all_scores


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
        print(f"Analyzing track: {audio_path}", file=sys.stderr)

        # 2. Madmom RNN
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
            tmp_path = tmp_file.name
        sf.write(tmp_path, y_analysis, sr)

        try:
            print("Step 1: Running RNNDownBeatProcessor...", file=sys.stderr)
            proc = RNNDownBeatProcessor()
            act = proc(tmp_path)

            rnn_fps = 100.0

            # ТРЕКЕР БИТОВ: FPS=100
            print(f"Step 2: Tracking beats (fps=100)...", file=sys.stderr)
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

        # 3. BPM (STRICT MEAN LOGIC)
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
                    print(f"[Analysis] Correction: Doubling BPM (Mean {bpm_mean:.2f} -> ~{bpm_global:.2f})", file=sys.stderr)
                    bpm_mean *= 2
                elif 0.4 < ratio < 0.6:
                    print(f"[Analysis] Correction: Halving BPM (Mean {bpm_mean:.2f} -> ~{bpm_global:.2f})", file=sys.stderr)
                    bpm_mean /= 2
                else:
                    print(f"[Analysis] Keeping Mean BPM: {bpm_mean:.2f}", file=sys.stderr)

            bpm = int(round(bpm_mean))
            print(f"[Analysis] Final BPM: {bpm}", file=sys.stderr)

        except Exception as e:
            print(f"[Analysis] Warning: BPM calc failed ({e}), using simple median", file=sys.stderr)
            if len(all_beats) > 1:
                bpm = round(60.0 / np.mean(np.diff(all_beats)))
            else:
                bpm = 120

        # 4. Offset (CORRELATION LOGIC)
        print("Step 4: Finding best phase via correlation...", file=sys.stderr)
        best_phase, best_score, all_scores = find_best_phase(all_beats, act, rnn_fps)

        found_offset = all_beats[best_phase]
        print(f"[Analysis] Best phase beat index: {best_phase} (Time: {found_offset:.3f}s)", file=sys.stderr)

        # --- SHIFT OFFSET TO START ---
        beat_interval = 60.0 / bpm
        section_duration = 8 * beat_interval

        shifted_offset = found_offset
        while shifted_offset - section_duration >= 0.0:
            shifted_offset -= section_duration

        offset = shifted_offset
        print(f"[Analysis] Shifted Offset to Start: {offset:.3f}s (Original found at {found_offset:.3f}s)", file=sys.stderr)

        # 5. Генерация Grid
        print("Step 5: Generating Grid...", file=sys.stderr)

        grid = []
        current_time = offset

        # Safety: go backwards if needed
        while current_time > 0:
            current_time -= section_duration

        # Forwards to end
        while current_time < duration:
            end_time = current_time + section_duration
            if end_time > 0:
                start_display = round(current_time, 3)
                if start_display < 0 and start_display > -0.1:
                    start_display = 0.0
                grid.append({
                    "type": "verse",
                    "start": start_display,
                    "beats": 8
                })
            current_time += section_duration

        downbeats = []
        db_time = offset
        while db_time < duration:
            if db_time >= 0:
                downbeats.append(round(db_time, 3))
            db_time += beat_interval * 4

        result = {
            'bpm': bpm,
            'offset': round(offset, 3),
            'duration': duration,
            'grid': grid,
            'downbeats': downbeats,
            'totalBeats': len(all_beats),
            'analysis': {
                'version': 'correlation-v1.0',
                'best_phase': best_phase,
                'best_score': round(best_score, 3),
                'all_scores': all_scores,
                'found_offset': round(found_offset, 3)
            }
        }
        return result

    except Exception as e:
        print(f"Error in analysis: {str(e)}", file=sys.stderr)
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
