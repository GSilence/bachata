import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isS3Enabled, downloadFile, keyFromUrl } from "@/lib/storage";
import { generateFingerprint } from "@/lib/fingerprint";
import { join } from "path";
import { existsSync, mkdirSync, rmSync } from "fs";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/fingerprint-all
 * Returns stats: how many tracks have/don't have fingerprints.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  }

  const [total, withFp, withError] = await Promise.all([
    prisma.track.count(),
    prisma.track.count({ where: { audioFingerprint: { not: null }, NOT: { audioFingerprint: "error" } } }),
    prisma.track.count({ where: { audioFingerprint: "error" } }),
  ]);

  return NextResponse.json({ total, withFingerprint: withFp, withError, without: total - withFp - withError });
}

/**
 * POST /api/admin/fingerprint-all
 * Process one track without fingerprint. Call repeatedly to process all.
 * Returns { processed, trackId, remaining } or { done: true }.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  }

  // Find one track without fingerprint
  const track = await prisma.track.findFirst({
    where: { audioFingerprint: null },
    select: { id: true, pathOriginal: true, filename: true, title: true },
    orderBy: { id: "asc" },
  });

  if (!track) {
    return NextResponse.json({ done: true, message: "All tracks have fingerprints" });
  }

  let localPath: string | null = null;
  let needsCleanup = false;

  try {
    if (isS3Enabled() && track.pathOriginal) {
      const tempDir = join(process.cwd(), "public", "uploads", "temp");
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
      localPath = join(tempDir, `fp_${track.id}_${track.filename}`);

      const s3Key = keyFromUrl(track.pathOriginal);
      if (!s3Key) throw new Error("Cannot determine S3 key");

      await downloadFile(s3Key, localPath);
      needsCleanup = true;
    } else {
      const rawPath = join(process.cwd(), "public", "uploads", "raw", track.filename);
      if (!existsSync(rawPath)) throw new Error("File not found");
      localPath = rawPath;
    }

    const { fingerprint, duration } = await generateFingerprint(localPath);

    await prisma.track.update({
      where: { id: track.id },
      data: { audioFingerprint: JSON.stringify(fingerprint), fingerprintDuration: duration },
    });

    const remaining = await prisma.track.count({ where: { audioFingerprint: null } });

    return NextResponse.json({
      processed: true,
      trackId: track.id,
      title: track.title,
      duration,
      remaining,
    });
  } catch (err: any) {
    // Mark track with "error" so it's skipped on next call (not stuck in loop)
    try {
      await prisma.track.update({
        where: { id: track.id },
        data: { audioFingerprint: "error" },
      });
    } catch {}
    return NextResponse.json({
      processed: false,
      trackId: track.id,
      title: track.title,
      error: err.message,
      remaining: await prisma.track.count({ where: { audioFingerprint: null } }),
    });
  } finally {
    if (needsCleanup && localPath) {
      try { rmSync(localPath); } catch {}
    }
  }
}
