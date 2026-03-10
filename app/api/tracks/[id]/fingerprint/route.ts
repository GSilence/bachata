import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isS3Enabled, downloadFile, keyFromUrl } from "@/lib/storage";
import { generateFingerprint } from "@/lib/fingerprint";
import { join } from "path";
import { existsSync, mkdirSync, rmSync } from "fs";

export const dynamic = "force-dynamic";

/**
 * POST /api/tracks/[id]/fingerprint
 *
 * Generate Chromaprint fingerprint for a track and save to DB.
 * Downloads file from S3 (or uses local), runs fpcalc, cleans up.
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

  const { id } = await params;
  const trackId = parseInt(id, 10);
  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
  }

  if (!prisma) {
    return NextResponse.json({ error: "DB unavailable" }, { status: 500 });
  }

  const track = await prisma.track.findUnique({
    where: { id: trackId },
    select: { id: true, pathOriginal: true, filename: true, audioFingerprint: true },
  });

  if (!track) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  let localPath: string | null = null;
  let needsCleanup = false;

  try {
    if (isS3Enabled() && track.pathOriginal) {
      // Download from S3 to temp
      const tempDir = join(process.cwd(), "public", "uploads", "temp");
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
      localPath = join(tempDir, `fp_${trackId}_${track.filename}`);

      const s3Key = keyFromUrl(track.pathOriginal);
      if (!s3Key) {
        return NextResponse.json({ error: "Cannot determine S3 key" }, { status: 400 });
      }

      await downloadFile(s3Key, localPath);
      needsCleanup = true;
    } else {
      // Local file
      const rawPath = join(process.cwd(), "public", "uploads", "raw", track.filename);
      if (!existsSync(rawPath)) {
        return NextResponse.json({ error: "Audio file not found locally" }, { status: 404 });
      }
      localPath = rawPath;
    }

    // Generate raw fingerprint (array of int32)
    const { fingerprint, duration } = await generateFingerprint(localPath);

    // Save as JSON string
    await prisma.track.update({
      where: { id: trackId },
      data: {
        audioFingerprint: JSON.stringify(fingerprint),
        fingerprintDuration: duration,
      },
    });

    return NextResponse.json({
      success: true,
      trackId,
      fingerprintLength: fingerprint.length,
      duration,
    });
  } catch (err: any) {
    console.error(`[fingerprint] Track #${trackId} error:`, err.message);
    return NextResponse.json(
      { error: err.message || "Fingerprint generation failed" },
      { status: 500 },
    );
  } finally {
    // Cleanup temp file
    if (needsCleanup && localPath) {
      try { rmSync(localPath); } catch {}
    }
  }
}
