import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isS3Enabled, downloadFile, keyFromUrl } from "@/lib/storage";
import { join } from "path";
import { existsSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { randomBytes } from "crypto";
import { lookupByFingerprint, uploadCoverArt } from "@/app/api/tracks/[id]/lookup-metadata/route";

export const dynamic = "force-dynamic";

const AUTO_SAVE_THRESHOLD = 0.80;

/**
 * GET /api/admin/lookup-metadata-all
 * Returns stats: how many tracks are processed / pending.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const acoustidKey = process.env.ACOUSTID_API_KEY;

  const [total, done, withMeta] = await Promise.all([
    prisma.track.count({ where: { pathOriginal: { not: null } } }),
    prisma.track.count({ where: { metaLookupDone: true } }),
    prisma.track.count({ where: { metaTitle: { not: null } } }),
  ]);

  return NextResponse.json({
    total,
    done,
    pending: total - done,
    withMeta,
    hasApiKey: !!acoustidKey,
  });
}

/**
 * POST /api/admin/lookup-metadata-all
 * Process one unprocessed track. Call repeatedly to process all.
 * Returns { processed, saved, trackId, title } or { done: true }.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) return NextResponse.json({ error: "DB unavailable" }, { status: 500 });

  const acoustidKey = process.env.ACOUSTID_API_KEY;
  if (!acoustidKey) {
    return NextResponse.json({ error: "ACOUSTID_API_KEY not set" }, { status: 500 });
  }

  const track = await prisma.track.findFirst({
    where: { metaLookupDone: false, pathOriginal: { not: null } },
    select: { id: true, pathOriginal: true, filename: true, title: true },
    orderBy: { id: "asc" },
  });

  if (!track) {
    return NextResponse.json({ done: true, message: "All tracks processed" });
  }

  let tempPath: string | null = null;

  try {
    let filePath: string;

    if (isS3Enabled() && track.pathOriginal) {
      const s3Key = keyFromUrl(track.pathOriginal);
      if (!s3Key) throw new Error("Cannot determine S3 key");
      const ext = s3Key.split(".").pop() || "mp3";
      tempPath = join(tmpdir(), `meta_${randomBytes(8).toString("hex")}.${ext}`);
      await downloadFile(s3Key, tempPath);
      filePath = tempPath;
    } else {
      const rawPath = join(process.cwd(), "public", "uploads", "raw", track.filename ?? "");
      if (!existsSync(rawPath)) throw new Error("File not found");
      filePath = rawPath;
    }

    const output = await lookupByFingerprint(filePath, acoustidKey);
    const finalBest = output.best as any;
    let saved = false;

    if (finalBest && finalBest.score >= AUTO_SAVE_THRESHOLD) {
      const artist = (finalBest.artist || "").trim();
      const album = (finalBest.album || "").trim();
      const coverBasename = album ? `${artist}-${album}` : null;
      const ownCoverUrl = (finalBest.coverArtUrl && coverBasename)
        ? await uploadCoverArt(finalBest.coverArtUrl, coverBasename)
        : null;

      await prisma.track.update({
        where: { id: track.id },
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
    } else {
      await prisma.track.update({
        where: { id: track.id },
        data: { metaLookupDone: true },
      });
    }

    const pending = await prisma.track.count({ where: { metaLookupDone: false, pathOriginal: { not: null } } });

    return NextResponse.json({
      processed: true,
      saved,
      found: output.found,
      trackId: track.id,
      title: track.title,
      best: finalBest ? { title: finalBest.title, artist: finalBest.artist, confidence_pct: finalBest.confidence_pct } : null,
      pending,
    });
  } catch (err: any) {
    // Mark as done to avoid retrying broken tracks
    try {
      await prisma.track.update({ where: { id: track.id }, data: { metaLookupDone: true } });
    } catch {}
    const pending = await prisma.track.count({ where: { metaLookupDone: false, pathOriginal: { not: null } } });
    return NextResponse.json({ processed: false, saved: false, found: false, trackId: track.id, title: track.title, error: err.message, pending });
  } finally {
    if (tempPath) {
      try { unlinkSync(tempPath); } catch {}
    }
  }
}
