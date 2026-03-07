import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { requireAdmin } from "@/lib/auth";
import { uploadFile, getFileUrl, isS3Enabled } from "@/lib/storage";

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

/** GET /api/admin/migrate-to-s3 — статистика: сколько локальных и S3 треков */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const total = await prisma.track.count();
  const localCount = await prisma.track.count({
    where: { pathOriginal: { startsWith: "/uploads/" } },
  });
  const s3Count = total - localCount;

  return NextResponse.json({ total, localCount, s3Count });
}

/** POST /api/admin/migrate-to-s3 — переносит один трек в S3, обновляет pathOriginal в БД */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isS3Enabled()) {
    return NextResponse.json({ error: "S3 not configured" }, { status: 400 });
  }

  // Берём следующий локальный трек
  const track = await prisma.track.findFirst({
    where: { pathOriginal: { startsWith: "/uploads/" } },
    orderBy: { id: "asc" },
    select: { id: true, title: true, artist: true, pathOriginal: true, filename: true },
  });

  if (!track) {
    return NextResponse.json({ done: true, message: "Все треки уже в S3" });
  }

  // Определяем имя файла из pathOriginal
  // pathOriginal = "/uploads/raw/song.mp3" → key = "raw/song.mp3"
  const key = track.pathOriginal!.replace(/^\/uploads\//, "");
  const localPath = join(process.cwd(), "public", track.pathOriginal!);

  if (!existsSync(localPath)) {
    // Файл не найден локально — обновляем URL на S3 «как есть» (возможно уже там)
    const s3Url = getFileUrl(key);
    await prisma.track.update({
      where: { id: track.id },
      data: { pathOriginal: s3Url },
    });
    return NextResponse.json({
      done: false,
      skipped: true,
      trackId: track.id,
      title: track.title,
      message: `Файл не найден локально, URL обновлён: ${key}`,
    });
  }

  // Загружаем в S3
  await uploadFile(localPath, key);
  const s3Url = getFileUrl(key);

  // Обновляем pathOriginal в БД
  await prisma.track.update({
    where: { id: track.id },
    data: { pathOriginal: s3Url },
  });

  // Считаем оставшиеся
  const remaining = await prisma.track.count({
    where: { pathOriginal: { startsWith: "/uploads/" } },
  });

  return NextResponse.json({
    done: remaining === 0,
    trackId: track.id,
    title: track.title,
    artist: track.artist,
    s3Url,
    remaining,
  });
}
