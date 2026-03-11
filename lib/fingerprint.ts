/**
 * Audio fingerprint helpers using Chromaprint (fpcalc).
 *
 * Uses RAW fingerprint mode (array of 32-bit integers) for reliable
 * sliding-window comparison with Hamming distance.
 *
 * fpcalc binary locations:
 *  - Windows (dev): bin/fpcalc.exe (project-local)
 *  - Linux (prod):  system PATH (apt install libchromaprint-tools)
 */

import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomBytes } from "crypto";

const execAsync = promisify(exec);

// ─── Config ──────────────────────────────────────────────────────────────────

interface FingerprintConfig {
  ber_threshold: number;
  max_frames: number;
  duration_tolerance_seconds: number;
  max_shift: number;
  min_overlap: number;
}

let _fpConfig: FingerprintConfig | null = null;

const DEFAULT_FP_CONFIG: FingerprintConfig = {
  ber_threshold: 0.15,
  max_frames: 300,
  duration_tolerance_seconds: 20,
  max_shift: 50,
  min_overlap: 20,
};

export function getFingerprintConfig(): FingerprintConfig {
  if (_fpConfig) return _fpConfig;
  try {
    const raw = readFileSync(join(process.cwd(), "config", "analysis-thresholds.json"), "utf-8");
    const parsed = JSON.parse(raw);
    _fpConfig = parsed.fingerprint
      ? { ...DEFAULT_FP_CONFIG, ...parsed.fingerprint }
      : DEFAULT_FP_CONFIG;
    return _fpConfig!;
  } catch {
    _fpConfig = DEFAULT_FP_CONFIG;
    return _fpConfig;
  }
}

/** Reset cached config (e.g. after config file changes) */
export function resetFingerprintConfig() { _fpConfig = null; }

/**
 * Resolve fpcalc binary path:
 *  1. FPCALC_PATH env var
 *  2. bin/fpcalc.exe (Windows dev)
 *  3. "fpcalc" (system PATH, Linux prod)
 */
function getFpcalcPath(): string {
  if (process.env.FPCALC_PATH) return process.env.FPCALC_PATH;
  const localBin = join(process.cwd(), "bin", "fpcalc.exe");
  if (existsSync(localBin)) return localBin;
  return "fpcalc";
}

/**
 * BER (Bit Error Rate) threshold for duplicate detection.
 * Reads from config/analysis-thresholds.json → fingerprint.ber_threshold.
 * <= 0.15 means same track (allows re-encoding, slight noise).
 */
export function getFingerprintBerThreshold(): number {
  return getFingerprintConfig().ber_threshold;
}
/** @deprecated Use getFingerprintBerThreshold() for dynamic config */
export const FINGERPRINT_BER_THRESHOLD = 0.15;

export interface FingerprintResult {
  /** Raw fingerprint: array of 32-bit integers */
  fingerprint: number[];
  /** Track duration in seconds */
  duration: number;
}

/**
 * Generate raw Chromaprint fingerprint for an audio file.
 * Uses `fpcalc -raw -json` to get integer array directly.
 *
 * On failure, retries after remuxing through ffmpeg to strip junk bytes
 * (e.g. Traktor DJ marker blocks embedded mid-stream).
 */
export async function generateFingerprint(
  audioPath: string,
): Promise<FingerprintResult> {
  const fpcalc = getFpcalcPath();

  async function runFpcalc(filePath: string): Promise<FingerprintResult> {
    const { stdout } = await execAsync(
      `"${fpcalc}" -raw -json "${filePath}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 },
    );
    const result = JSON.parse(stdout.trim());
    if (!result.fingerprint || !Array.isArray(result.fingerprint) || result.fingerprint.length === 0) {
      throw new Error("fpcalc returned no fingerprint");
    }
    return { fingerprint: result.fingerprint, duration: result.duration };
  }

  // First attempt — direct
  try {
    return await runFpcalc(audioPath);
  } catch {
    // Fallback: decode to WAV via ffmpeg (handles junk bytes, Traktor markers, etc.)
    // -c copy preserves corrupt stream; full PCM decode produces a clean file.
    const tmpPath = join(tmpdir(), `fp_remux_${randomBytes(8).toString("hex")}.wav`);
    try {
      await execAsync(
        `ffmpeg -v quiet -i "${audioPath}" -c:a pcm_s16le -ar 44100 -ac 2 -y "${tmpPath}"`,
        { timeout: 120_000 },
      );
      return await runFpcalc(tmpPath);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore cleanup errors */ }
    }
  }
}

// ─── Comparison ─────────────────────────────────────────────────────────────

/**
 * Popcount: count set bits in a 32-bit integer.
 */
function popcount(x: number): number {
  x = x - ((x >> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
  return (((x + (x >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
}

/**
 * Compare two raw fingerprints using sliding-window Hamming distance.
 *
 * Slides the shorter array along the longer one, computing BER (Bit Error Rate)
 * at each offset. Returns the minimum BER found.
 *
 * @returns BER (0.0 = identical, 1.0 = completely different).
 *          Use `ber <= FINGERPRINT_BER_THRESHOLD` to check for duplicates.
 */
export function compareFingerprints(
  fp1: number[],
  fp2: number[],
  earlyExitBer?: number,
  maxFrames?: number,
): number {
  const cfg = getFingerprintConfig();
  const threshold = earlyExitBer ?? cfg.ber_threshold;
  const frameLimit = maxFrames ?? cfg.max_frames;

  if (!fp1?.length || !fp2?.length) return 1.0;

  // Trim to maxFrames (compare only first ~30 seconds)
  const trimmed1 = frameLimit > 0 && fp1.length > frameLimit ? fp1.slice(0, frameLimit) : fp1;
  const trimmed2 = frameLimit > 0 && fp2.length > frameLimit ? fp2.slice(0, frameLimit) : fp2;

  // Determine short/long
  let shortFp: number[], longFp: number[];
  if (trimmed1.length > trimmed2.length) {
    shortFp = trimmed2;
    longFp = trimmed1;
  } else {
    shortFp = trimmed1;
    longFp = trimmed2;
  }

  const lenShort = shortFp.length;
  const lenLong = longFp.length;

  if (lenShort < 10) return 1.0;

  // If lengths differ too much (>50%), unlikely same track
  if (lenShort < lenLong * 0.5) return 1.0;

  let bestScore = 1.0;

  // Max offset to try: covers ~5 seconds at ~10 fps,
  // plus any length difference between the tracks
  const MAX_SHIFT = cfg.max_shift;
  const maxOffset = Math.max(lenLong - lenShort, 0) + MAX_SHIFT;

  for (let offset = 0; offset <= maxOffset; offset++) {
    // Forward: skip `offset` frames of longFp
    const overlapFwd = Math.min(lenShort, lenLong - offset);
    if (overlapFwd >= 20) {
      const totalBits = overlapFwd * 32;
      let totalBitErrors = 0;
      let earlyBreak = false;
      for (let i = 0; i < overlapFwd; i++) {
        totalBitErrors += popcount((shortFp[i] ^ longFp[i + offset]) >>> 0);
        if (totalBitErrors / totalBits > threshold) { earlyBreak = true; break; }
      }
      if (!earlyBreak) {
        const score = totalBitErrors / totalBits;
        if (score < bestScore) {
          bestScore = score;
          if (bestScore < 0.01) return bestScore;
        }
      }
    }

    // Reverse: skip `offset` frames of shortFp (only if offset > 0 to avoid double-counting)
    if (offset > 0) {
      const overlapRev = Math.min(lenShort - offset, lenLong);
      if (overlapRev >= 20) {
        const totalBits = overlapRev * 32;
        let totalBitErrors = 0;
        let earlyBreak = false;
        for (let i = 0; i < overlapRev; i++) {
          totalBitErrors += popcount((shortFp[i + offset] ^ longFp[i]) >>> 0);
          if (totalBitErrors / totalBits > threshold) { earlyBreak = true; break; }
        }
        if (!earlyBreak) {
          const score = totalBitErrors / totalBits;
          if (score < bestScore) {
            bestScore = score;
            if (bestScore < 0.01) return bestScore;
          }
        }
      }
    }
  }

  return bestScore;
}

/**
 * Parse raw fingerprint from DB (stored as JSON string).
 */
export function parseStoredFingerprint(stored: string | null): number[] | null {
  if (!stored) return null;
  try {
    const arr = JSON.parse(stored);
    if (Array.isArray(arr) && arr.length > 0) return arr;
    return null;
  } catch {
    return null;
  }
}

// ─── DB operations ──────────────────────────────────────────────────────────

/**
 * Find duplicate track by fingerprint.
 * Queries all tracks with fingerprints and compares in JS using sliding window.
 *
 * @returns matching track id + BER score, or null
 */
export async function findDuplicateByFingerprint(
  prisma: any,
  newFingerprint: number[],
  excludeTrackId?: number,
  newDuration?: number,
): Promise<{ trackId: number; ber: number } | null> {
  const cfg = getFingerprintConfig();

  // Pre-filter by duration if available
  const where: any = {
    audioFingerprint: { not: null },
    NOT: { audioFingerprint: "error" },
  };
  if (newDuration != null && cfg.duration_tolerance_seconds > 0) {
    where.fingerprintDuration = {
      gte: newDuration - cfg.duration_tolerance_seconds,
      lte: newDuration + cfg.duration_tolerance_seconds,
    };
  }

  const tracks = await prisma.track.findMany({
    where,
    select: { id: true, audioFingerprint: true },
  });

  let bestMatch: { trackId: number; ber: number } | null = null;

  for (const track of tracks) {
    if (excludeTrackId && track.id === excludeTrackId) continue;
    const dbFp = parseStoredFingerprint(track.audioFingerprint);
    if (!dbFp) continue;
    const ber = compareFingerprints(newFingerprint, dbFp);
    if (ber <= cfg.ber_threshold) {
      if (!bestMatch || ber < bestMatch.ber) {
        bestMatch = { trackId: track.id, ber };
      }
    }
  }

  return bestMatch;
}

/**
 * Find ALL duplicate clusters across the library.
 * Returns groups of tracks that match each other.
 */
export async function findAllDuplicateClusters(
  prisma: any,
  threshold?: number,
): Promise<{ clusters: { trackIds: number[]; ber: number }[] }> {
  const cfg = getFingerprintConfig();
  const berThreshold = threshold ?? cfg.ber_threshold;
  const durationTolerance = cfg.duration_tolerance_seconds;

  const tracks = await prisma.track.findMany({
    where: {
      audioFingerprint: { not: null },
      NOT: { audioFingerprint: "error" },
    },
    select: { id: true, audioFingerprint: true, fingerprintDuration: true },
  });

  // Parse all fingerprints
  const parsed: { id: number; fp: number[]; duration: number | null }[] = [];
  for (const t of tracks) {
    const fp = parseStoredFingerprint(t.audioFingerprint);
    if (fp) parsed.push({ id: t.id, fp, duration: t.fingerprintDuration });
  }

  // Union-Find for clustering
  const parent = new Map<number, number>();
  const rank = new Map<number, number>();
  const clusterBer = new Map<string, number>();

  function find(x: number): number {
    if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }

  function union(a: number, b: number) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) || 0, rankB = rank.get(rb) || 0;
    if (rankA < rankB) parent.set(ra, rb);
    else if (rankA > rankB) parent.set(rb, ra);
    else { parent.set(rb, ra); rank.set(ra, rankA + 1); }
  }

  // Pairwise comparison with duration pre-filter
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      // Duration pre-filter: skip if durations differ by more than tolerance
      if (durationTolerance > 0 && parsed[i].duration != null && parsed[j].duration != null) {
        if (Math.abs(parsed[i].duration! - parsed[j].duration!) > durationTolerance) continue;
      }

      const ber = compareFingerprints(parsed[i].fp, parsed[j].fp, berThreshold);
      if (ber <= berThreshold) {
        union(parsed[i].id, parsed[j].id);
        const key = `${Math.min(parsed[i].id, parsed[j].id)}-${Math.max(parsed[i].id, parsed[j].id)}`;
        clusterBer.set(key, ber);
      }
    }
  }

  // Group by cluster root
  const groups = new Map<number, number[]>();
  for (const t of parsed) {
    const root = find(t.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(t.id);
  }

  // Filter to clusters with 2+ tracks and compute avg BER
  const clusters: { trackIds: number[]; ber: number }[] = [];
  for (const [, ids] of groups) {
    if (ids.length < 2) continue;
    let totalBer = 0, count = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${Math.min(ids[i], ids[j])}-${Math.max(ids[i], ids[j])}`;
        if (clusterBer.has(key)) { totalBer += clusterBer.get(key)!; count++; }
      }
    }
    clusters.push({ trackIds: ids, ber: count > 0 ? totalBer / count : 0 });
  }

  return { clusters };
}
