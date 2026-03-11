import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { isS3Enabled, keyFromUrl, downloadFile, uploadBuffer } from "@/lib/storage";

export const runtime = "nodejs";

const execAsync = promisify(exec);

export function getFpcalcPath(): string {
  if (process.env.FPCALC_PATH) return process.env.FPCALC_PATH;
  const localBin = join(process.cwd(), "bin", "fpcalc.exe");
  if (existsSync(localBin)) return localBin;
  return "fpcalc";
}

/** Generate compressed Chromaprint fingerprint (base64) using fpcalc. */
export async function runFpcalcCompressed(filePath: string): Promise<{ fingerprint: string; duration: number }> {
  const fpcalc = getFpcalcPath();

  async function runOnce(path: string) {
    const { stdout } = await execAsync(
      `"${fpcalc}" -json "${path}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 },
    );
    const res = JSON.parse(stdout.trim());
    if (!res.fingerprint || !res.duration) throw new Error("fpcalc returned no fingerprint");
    return res as { fingerprint: string; duration: number };
  }

  try {
    return await runOnce(filePath);
  } catch {
    // Fallback: decode to WAV via ffmpeg (handles junk bytes, Traktor markers, etc.)
    const wavPath = join(tmpdir(), `meta_wav_${randomBytes(8).toString("hex")}.wav`);
    try {
      await execAsync(
        `ffmpeg -v quiet -i "${filePath}" -c:a pcm_s16le -ar 44100 -ac 2 -y "${wavPath}"`,
        { timeout: 120_000 },
      );
      return await runOnce(wavPath);
    } finally {
      try { unlinkSync(wavPath); } catch {}
    }
  }
}

/** Query AcoustID + MusicBrainz for a file. Returns candidates and enriched best match. */
export async function lookupByFingerprint(filePath: string, acoustidKey: string) {
  // Step 1: fingerprint
  const { fingerprint, duration } = await runFpcalcCompressed(filePath);

  // Step 2: AcoustID
  const acoustidBody = new URLSearchParams({
    client: acoustidKey,
    fingerprint,
    duration: String(Math.round(duration)),
    meta: "recordings releases tracks",
    format: "json",
  });

  const acoustidRes = await fetch("https://api.acoustid.org/v2/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: acoustidBody.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!acoustidRes.ok) {
    const errBody = await acoustidRes.text().catch(() => "");
    throw new Error(`AcoustID HTTP error: ${acoustidRes.status} — ${errBody}`);
  }

  const acoustidData = await acoustidRes.json() as {
    status: string;
    error?: { message: string };
    results?: Array<{
      id: string;
      score: number;
      recordings?: Array<{
        id: string;
        title?: string;
        artists?: Array<{ id: string; name: string }>;
        releases?: Array<{
          id: string;
          title?: string;
          date?: { year?: number; month?: number; day?: number } | string;
        }>;
      }>;
    }>;
  };

  if (acoustidData.status !== "ok") {
    throw new Error(`AcoustID error: ${acoustidData.error?.message ?? "unknown"}`);
  }

  // Step 3: Parse candidates
  const candidates: Array<{
    score: number;
    confidence_pct: number;
    mbid: string;
    title: string;
    artist: string;
    album: string | null;
    year: number | null;
    releaseMbid: string | null;
  }> = [];

  for (const result of acoustidData.results ?? []) {
    const score = result.score ?? 0;
    for (const recording of result.recordings ?? []) {
      const artistName = (recording.artists ?? []).map((a) => a.name).join(", ");
      const releases = recording.releases ?? [];
      let album: string | null = null;
      let year: number | null = null;
      let releaseMbid: string | null = null;

      if (releases.length > 0) {
        const rel = releases[0];
        album = rel.title ?? null;
        releaseMbid = rel.id ?? null;
        const date = rel.date;
        if (date && typeof date === "object" && date.year) {
          year = date.year;
        } else if (typeof date === "string" && date.length >= 4) {
          year = parseInt(date.slice(0, 4), 10) || null;
        }
      }

      candidates.push({
        score: Math.round(score * 10000) / 10000,
        confidence_pct: Math.round(score * 1000) / 10,
        mbid: recording.id,
        title: recording.title ?? "",
        artist: artistName,
        album,
        year,
        releaseMbid,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return { found: false as const, results: [], best: null };
  }

  // Step 4: Enrich best match via MusicBrainz
  const best = candidates[0];
  type Enriched = typeof candidates[0] & {
    tags: string[];
    isrcs: string[];
    label: string | null;
    coverArtUrl: string | null;
    musicbrainz_url: string;
  };
  let enriched: Enriched | null = null;

  if (best.mbid && best.score >= 0.70) {
    await new Promise((resolve) => setTimeout(resolve, 1000)); // MusicBrainz rate limit

    const mbUrl = `https://musicbrainz.org/ws/2/recording/${best.mbid}?inc=artists+releases+tags+isrcs&fmt=json`;
    const mbRes = await fetch(mbUrl, {
      headers: { "User-Agent": "BachataAnalyzer/1.0 (https://github.com/bachata-analyzer)" },
      signal: AbortSignal.timeout(30_000),
    });

    if (mbRes.ok) {
      const mbData = await mbRes.json() as {
        tags?: Array<{ name: string; count: number }>;
        isrcs?: string[];
        releases?: Array<{
          id?: string;
          title?: string;
          date?: string;
          "label-info"?: Array<{ label?: { name: string } }>;
        }>;
      };

      const tags = (mbData.tags ?? []).slice(0, 10).map((t) => t.name);
      const isrcs = (mbData.isrcs ?? []).slice(0, 3);
      const releaseList = mbData.releases ?? [];
      let mbAlbum: string | null = null;
      let mbYear: number | null = null;
      let mbLabel: string | null = null;
      let releaseMbid: string | null = best.releaseMbid;

      if (releaseList.length > 0) {
        const rel = releaseList[0];
        mbAlbum = rel.title ?? null;
        releaseMbid = rel.id ?? releaseMbid;
        const mbDate = rel.date ?? "";
        if (mbDate.length >= 4) mbYear = parseInt(mbDate.slice(0, 4), 10) || null;
        const labelInfo = rel["label-info"] ?? [];
        if (labelInfo.length > 0) mbLabel = labelInfo[0]?.label?.name ?? null;
      }

      const coverArtUrl = releaseMbid
        ? `https://coverartarchive.org/release/${releaseMbid}/front-250`
        : null;

      enriched = {
        ...best,
        tags,
        isrcs,
        album: mbAlbum ?? best.album,
        year: mbYear ?? best.year,
        label: mbLabel,
        coverArtUrl,
        musicbrainz_url: `https://musicbrainz.org/recording/${best.mbid}`,
      };
    } else {
      enriched = { ...best, tags: [], isrcs: [], label: null, coverArtUrl: null, musicbrainz_url: `https://musicbrainz.org/recording/${best.mbid}` };
    }
  }

  return {
    found: true as const,
    results: candidates.slice(0, 5),
    best: enriched ?? { ...best, tags: [], isrcs: [], label: null, coverArtUrl: null, musicbrainz_url: "" },
  };
}

/**
 * Downloads cover art from Cover Art Archive and uploads to our S3 storage.
 * @param caaUrl  — URL from coverartarchive.org
 * @param basename — track filename without extension (used as cover name)
 * @returns our own cover URL, or null on failure
 */
export async function uploadCoverArt(caaUrl: string, basename: string): Promise<string | null> {
  // Sanitize basename for safe S3 key (remove apostrophes, brackets, etc.)
  const safeBasename = basename.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 200);
  try {
    const imgRes = await fetch(caaUrl, {
      headers: { "User-Agent": "BachataAnalyzer/1.0 (https://github.com/bachata-analyzer)" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!imgRes.ok) {
      console.warn(`[uploadCoverArt] CAA returned ${imgRes.status} for ${caaUrl}`);
      return null;
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const url = await uploadBuffer(buffer, `covers/${safeBasename}.jpg`);
    console.log(`[uploadCoverArt] Uploaded cover → ${url}`);
    return url;
  } catch (err) {
    console.warn(`[uploadCoverArt] Failed for "${safeBasename}":`, err);
    return null;
  }
}

const AUTO_SAVE_THRESHOLD = 0.80;

/**
 * POST /api/tracks/[id]/lookup-metadata
 * Looks up track metadata via AcoustID + MusicBrainz REST APIs.
 * Auto-saves to DB when confidence >= 90%.
 * Admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const acoustidKey = process.env.ACOUSTID_API_KEY;
  if (!acoustidKey) {
    return NextResponse.json(
      { error: "ACOUSTID_API_KEY not set in environment" },
      { status: 500 },
    );
  }

  let tempPath: string | null = null;

  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
    if (!prisma) return NextResponse.json({ error: "DB not configured" }, { status: 500 });

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!track.pathOriginal) return NextResponse.json({ error: "No audio file path" }, { status: 400 });

    // Resolve file path (S3 or local)
    let filePath: string;
    if (isS3Enabled()) {
      const s3Key = keyFromUrl(track.pathOriginal);
      if (!s3Key) return NextResponse.json({ error: "Cannot resolve S3 key" }, { status: 400 });
      const ext = s3Key.split(".").pop() || "mp3";
      tempPath = join(tmpdir(), `meta_${randomBytes(8).toString("hex")}.${ext}`);
      await downloadFile(s3Key, tempPath);
      filePath = tempPath;
    } else {
      const relativePath = track.pathOriginal.replace(/^\//, "");
      filePath = join(process.cwd(), "public", relativePath);
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: "Audio file not found on disk" }, { status: 404 });
      }
    }

    console.log(`[lookup-metadata] Track #${trackId}: ${track.title}`);

    const output = await lookupByFingerprint(filePath, acoustidKey);

    // Auto-save to DB if confident enough
    let saved = false;
    const finalBest = output.best as any;

    if (finalBest && finalBest.score >= AUTO_SAVE_THRESHOLD) {
      const artist = (finalBest.artist || "").trim();
      const album = (finalBest.album || "").trim();
      const coverBasename = album ? `${artist}-${album}` : null;
      const ownCoverUrl = (finalBest.coverArtUrl && coverBasename)
        ? await uploadCoverArt(finalBest.coverArtUrl, coverBasename)
        : null;

      await prisma.track.update({
        where: { id: trackId },
        data: {
          metaTitle: finalBest.title || null,
          metaArtist: finalBest.artist || null,
          metaAlbum: finalBest.album || null,
          metaYear: finalBest.year || null,
          coverArtUrl: ownCoverUrl,
          metaLookupDone: true,
        },
      });
      saved = true;
      console.log(`[lookup-metadata] Saved metadata for #${trackId} (${finalBest.confidence_pct}%)`);
    } else {
      await prisma.track.update({
        where: { id: trackId },
        data: { metaLookupDone: true },
      });
    }

    console.log(`[lookup-metadata] Result for track #${trackId} "${track.title}":`);
    console.log(JSON.stringify({ ...output, saved }, null, 2));

    return NextResponse.json({
      trackId,
      trackTitle: track.title,
      trackArtist: track.artist,
      saved,
      ...output,
    });
  } catch (err: unknown) {
    console.error("[lookup-metadata] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  } finally {
    if (tempPath) {
      try { unlinkSync(tempPath); } catch {}
    }
  }
}
