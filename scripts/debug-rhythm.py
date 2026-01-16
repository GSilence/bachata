#!/usr/bin/env python3
"""
Sherlock ver-2.01 (Atomic Inspector + Delta & HPSS)
- Logic:
  1. NO Grid Construction. Pure Data Extraction.
  2. Features:
     - 3-Band Energy (Low, Mid, High)
     - Madmom RNN Probabilities
     - NEW: Total Energy (Full Mix)
     - NEW: HPSS (Harmonic vs Percussive separation)
     - NEW: Delta % (Change relative to previous beat)
"""

import sys
import os
import glob
import json
import warnings
import numpy as np
import tempfile
import uuid
import collections
import collections.abc

# --- COMPATIBILITY FIXES ---
if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence

with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'): np.float = np.float64
    if not hasattr(np, 'int'): np.int = np.int64

import librosa
from scipy import signal
import soundfile as sf

try:
    from madmom.features import RNNDownBeatProcessor
    from madmom.features.beats import DBNBeatTrackingProcessor
except ImportError as e:
    print(f"Error: madmom is required. ({e})", file=sys.stderr)
    sys.exit(1)

# ==========================================
# SIGNAL PROCESSING TOOLS
# ==========================================

def get_rms_from_chunk(chunk):
    """Safe RMS calculation for a small audio array."""
    if len(chunk) == 0: return 0.0
    return float(np.sqrt(np.mean(chunk**2)))

def get_band_energy(y, sr, time_sec, freq_range, window_sec=0.1):
    """
    Extracts a chunk, filters it (if needed), returns RMS.
    freq_range: (low, high). Pass None to skip a bound.
    """
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    
    if start >= end: return 0.0
    chunk = y[start:end]
    
    # Too short to filter reliably? Return raw.
    if len(chunk) < 100: 
        return get_rms_from_chunk(chunk)

    # Filter design
    sos = None
    if freq_range[0] is not None and freq_range[1] is not None:
        sos = signal.butter(4, [freq_range[0], freq_range[1]], btype='band', fs=sr, output='sos')
    elif freq_range[0] is not None:
        sos = signal.butter(4, freq_range[0], btype='high', fs=sr, output='sos')
    elif freq_range[1] is not None:
        sos = signal.butter(4, freq_range[1], btype='low', fs=sr, output='sos')
        
    if sos is not None:
        filtered_chunk = signal.sosfilt(sos, chunk)
        return get_rms_from_chunk(filtered_chunk)
    else:
        # No filter requested -> Raw Energy
        return get_rms_from_chunk(chunk)

def get_spectral_flatness(y, sr, time_sec, window_sec=0.1):
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    if start >= end: return 0.0
    
    chunk = y[start:end]
    n_fft = min(512, len(chunk))
    if n_fft == 0: return 0.0
    flatness = librosa.feature.spectral_flatness(y=chunk, n_fft=n_fft)
    return float(np.mean(flatness))

def get_chunk_at_time(y, sr, time_sec, window_sec=0.1):
    """Helper to just get the raw audio chunk at time t."""
    half_window = int((window_sec * sr) / 2)
    center_sample = int(time_sec * sr)
    start = max(0, center_sample - half_window)
    end = min(len(y), center_sample + half_window)
    return y[start:end]

# ==========================================
# MAIN INVESTIGATION LOGIC
# ==========================================

def process_audio_file(audio_path, output_path=None):
    if not output_path:
        base, _ = os.path.splitext(audio_path)
        output_path = base + "_sherlock_2.01.json"
        
    print(f"\n[Sherlock ver-2.01] 🔍 Inspecting: {os.path.basename(audio_path)}")
    
    tmp_filename = f"sherlock_{uuid.uuid4().hex}.wav"
    tmp_path = os.path.join(tempfile.gettempdir(), tmp_filename)
    
    try:
        # 1. LOAD AUDIO
        y, sr = librosa.load(audio_path, sr=None, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        
        # 1.1 HPSS DECOMPOSITION (New Feature)
        # Separating Harmonic (Melody/Bass) from Percussive (Beats/Clicks)
        print(f"[Sherlock] Running Harmonic-Percussive Separation...")
        y_harm, y_perc = librosa.effects.hpss(y, margin=1.0)
        
        # 2. MADMOM ANALYSIS
        print(f"[Sherlock] Running Neural Networks...")
        sf.write(tmp_path, y, sr)
        
        rnn_proc = RNNDownBeatProcessor()
        activations = rnn_proc(tmp_path) 
        
        beat_proc = DBNBeatTrackingProcessor(fps=100)
        beat_times = beat_proc(activations[:, 0])
        
        all_beats = [float(b) for b in beat_times]
        
        if not all_beats:
            print("[Error] No beats detected.")
            return

        # 3. FORENSIC ANALYSIS PER BEAT
        print(f"[Sherlock] Examining {len(all_beats)} beats with extended metrics...")
        
        raw_data = []
        
        # Keep track of previous beat stats for "Delta" calculation
        prev_stats = {
            "low": 0.0, "mid": 0.0, "high": 0.0, "total": 0.0
        }

        for i, t in enumerate(all_beats):
            # A. Basic Bands
            e_low = get_band_energy(y, sr, t, (None, 200)) 
            e_mid = get_band_energy(y, sr, t, (200, 2000))
            e_high = get_band_energy(y, sr, t, (4000, None))
            
            # B. NEW: Total Energy (No filter)
            e_total = get_band_energy(y, sr, t, (None, None))
            
            # C. NEW: Decomposition Energy (HPSS)
            # We cut chunks manually from the pre-separated arrays
            chunk_h = get_chunk_at_time(y_harm, sr, t)
            chunk_p = get_chunk_at_time(y_perc, sr, t)
            e_harm = get_rms_from_chunk(chunk_h)
            e_perc = get_rms_from_chunk(chunk_p)
            
            # D. Flatness
            flat = get_spectral_flatness(y, sr, t)
            
            # E. Madmom Probabilities
            frame_idx = int(t * 100)
            if frame_idx >= len(activations): frame_idx = len(activations) - 1
            prob_downbeat = float(activations[frame_idx, 1]) 
            
            # F. Timing Delta
            delta_time = 0.0
            local_bpm = 0.0
            if i > 0:
                delta_time = t - all_beats[i-1]
                if delta_time > 0:
                    local_bpm = 60.0 / delta_time
            
            # G. NEW: Calculate Percentage Changes (Deltas) vs Previous Beat
            # Formula: (Current - Prev) / Prev * 100
            def get_pct_change(curr, prev):
                if prev < 0.000001: return 0.0 # Avoid division by zero
                return ((curr - prev) / prev) * 100.0

            diff_low = get_pct_change(e_low, prev_stats["low"])
            diff_mid = get_pct_change(e_mid, prev_stats["mid"])
            diff_high = get_pct_change(e_high, prev_stats["high"])
            diff_total = get_pct_change(e_total, prev_stats["total"])
            
            # Update prev for next loop
            prev_stats = {"low": e_low, "mid": e_mid, "high": e_high, "total": e_total}
            
            raw_data.append({
                "index": i,
                "time": t,
                "e_low": e_low,
                "e_mid": e_mid,
                "e_high": e_high,
                "e_total": e_total,     # New
                "e_harm": e_harm,       # New
                "e_perc": e_perc,       # New
                "flat": flat,
                "rnn_downbeat": prob_downbeat,
                "delta_time": delta_time,
                "bpm": local_bpm,
                "diffs": {              # New Block
                    "low": diff_low,
                    "mid": diff_mid,
                    "high": diff_high,
                    "total": diff_total
                }
            })

        # Calculate Max values for Normalization
        max_low = max([x['e_low'] for x in raw_data]) if raw_data else 1.0
        max_mid = max([x['e_mid'] for x in raw_data]) if raw_data else 1.0
        max_high = max([x['e_high'] for x in raw_data]) if raw_data else 1.0
        max_total = max([x['e_total'] for x in raw_data]) if raw_data else 1.0
        max_harm = max([x['e_harm'] for x in raw_data]) if raw_data else 1.0
        max_perc = max([x['e_perc'] for x in raw_data]) if raw_data else 1.0
        
        # Avoid zero division
        max_low = max_low if max_low > 0 else 1.0
        max_mid = max_mid if max_mid > 0 else 1.0
        max_high = max_high if max_high > 0 else 1.0
        max_total = max_total if max_total > 0 else 1.0
        max_harm = max_harm if max_harm > 0 else 1.0
        max_perc = max_perc if max_perc > 0 else 1.0

        # 4. FINALIZE REPORT
        final_beats = []
        for d in raw_data:
            final_beats.append({
                "id": d['index'],
                "time": round(d['time'], 3),
                "is_likely_downbeat": d['rnn_downbeat'] > 0.1,
                
                "energy_stats": {
                    "low": round(d['e_low'] / max_low, 3),
                    "mid": round(d['e_mid'] / max_mid, 3),
                    "high": round(d['e_high'] / max_high, 3),
                    "total_mix": round(d['e_total'] / max_total, 3), # NEW: Normalized Total
                    "flatness": round(d['flat'], 4)
                },
                
                "decomposition": { # NEW BLOCK
                    "harmonic": round(d['e_harm'] / max_harm, 3),
                    "percussive": round(d['e_perc'] / max_perc, 3),
                    # Ratio > 1 means very percussive, < 1 means melodic
                    "perc_harm_ratio": round(d['e_perc'] / (d['e_harm'] + 0.0001), 2)
                },
                
                "change_vs_prev_pct": { # NEW BLOCK
                    "low": round(d['diffs']['low'], 1),
                    "mid": round(d['diffs']['mid'], 1),
                    "high": round(d['diffs']['high'], 1),
                    "total": round(d['diffs']['total'], 1)
                },
                
                "madmom_score_1": round(d['rnn_downbeat'], 4),
                "timing": {
                    "delta": round(d['delta_time'], 3),
                    "bpm": int(d['bpm'])
                }
            })

        avg_bpm = np.mean([x['bpm'] for x in raw_data if x['bpm'] > 0])
        
        report = {
            "meta": {
                "version": "Sherlock ver-2.01",
                "filename": os.path.basename(audio_path),
                "duration": round(duration, 2),
                "total_beats": len(final_beats),
                "avg_bpm": int(avg_bpm)
            },
            "beats": final_beats
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)
            
        print(f"[Success] Saved -> {output_path}")

    except Exception as e:
        print(f"[Error] Processing failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if os.path.exists(tmp_path):
            try: os.remove(tmp_path)
            except: pass

def main():
    if len(sys.argv) < 2:
        print("Usage: python debug-rhythm.py <file_or_folder>", file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    
    if os.path.isdir(input_path):
        types = ('*.mp3', '*.wav', '*.flac', '*.m4a')
        files = []
        for ext in types:
            files.extend(glob.glob(os.path.join(input_path, ext)))
        for f in files:
            process_audio_file(f)
    elif os.path.isfile(input_path):
        process_audio_file(input_path)
    else:
        print("Error: Invalid path.")

if __name__ == '__main__':
    main()