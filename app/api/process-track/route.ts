import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { requireAuth } from "@/lib/auth";
import { isS3Enabled, uploadBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // только загрузка файла, анализ — в воркере

const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Ensure user has "uploads" playlist, add track to it */
async function addToUploadsPlaylist(prisma: any, userId: number, trackId: number) {
  let playlist = await prisma.playlist.findFirst({
    where: { userId, type: "uploads", isSystem: true },
  });
  if (!playlist) {
    playlist = await prisma.playlist.create({
      data: { userId, name: "Загруженное", type: "uploads", isSystem: true },
    });
  }
  try {
    await prisma.playlistItem.create({
      data: { playlistId: playlist.id, trackId },
    });
  } catch {
    // unique constraint — уже в плейлисте
  }
}

/**
 * Очистка строки метаданных из ID3-тегов:
 * — удаляет HTML-теги и управляющие символы (null-байты и т.п.)
 * — схлопывает лишние пробелы
 * — обрезает до maxLen символов
 * — если stripUrls=true — вырезает ссылки (http/https/www и домены .ru/.com/.org/...)
 */
function sanitizeMeta(
  value: string | null | undefined,
  maxLen: number,
  stripUrls = false,
): string | null {
  if (!value) return null;
  let s = value
    .replace(/<[^>]*>/g, "")                       // HTML-теги
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // управляющие символы (кроме \t \n \r)
    .replace(/\s+/g, " ")
    .trim();
  if (stripUrls) {
    s = s
      .replace(/https?:\/\/\S+/gi, "")                           // http(s)://...
      .replace(/www\.\S+/gi, "")                                  // www....
      .replace(/\S+\.(ru|com|org|net|info|biz|me|pro|tv|cc|io|co|xyz|site|online|store|shop|club|top|link|space|live|music)\b\S*/gi, "") // bare domains
      .replace(/\s+/g, " ")
      .trim();
  }
  return s.slice(0, maxLen) || null;
}

/** Нормализация для имени файла: нижний регистр, слова через дефис, только ASCII. */
function normalizeFilename(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 200);
  return s || "track";
}

/** Уникальный путь: base.ext, base_2.ext, ... */
function getUniqueFilePath(
  dir: string,
  baseName: string,
  ext: string,
): { filePath: string; fileName: string } {
  let candidate = baseName;
  let n = 0;
  let filePath = join(dir, `${candidate}.${ext}`);
  while (existsSync(filePath)) {
    n += 1;
    candidate = `${baseName}_${n}`;
    filePath = join(dir, `${candidate}.${ext}`);
  }
  return { filePath, fileName: `${candidate}.${ext}` };
}

export async function POST(request: NextRequest) {
  let currentUserId: number | null = null;
  try {
    const user = await requireAuth(request);
    currentUserId = user.userId;
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const title = formData.get("title") as string | null;
    const artist = formData.get("artist") as string | null;
    const album = formData.get("album") as string | null;
    const genre = formData.get("genre") as string | null;
    const year = formData.get("year") as string | null;
    const trackNumber = formData.get("track") as string | null;


    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Проверка типа файла: только аудио, без видео
    const lowerName = file.name.toLowerCase();
    const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".flv", ".ogv"];
    if (videoExtensions.some((ext) => lowerName.endsWith(ext)) || file.type.startsWith("video/")) {
      return NextResponse.json(
        { error: "Загрузка видео запрещена. Разрешены только аудиофайлы." },
        { status: 400 },
      );
    }
    const allowedAudioExtensions = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac"];
    if (!allowedAudioExtensions.some((ext) => lowerName.endsWith(ext)) && !file.type.startsWith("audio/")) {
      return NextResponse.json(
        { error: "Разрешены только аудиофайлы (MP3, M4A, WAV и т.д.)." },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 },
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileHash = createHash("md5").update(buffer).digest("hex");

    const { prisma } = await import("@/lib/prisma");
    if (!prisma) {
      return NextResponse.json({ error: "Database not available" }, { status: 500 });
    }

    const trimmedTitle  = sanitizeMeta(title, 500, true) ?? title.trim();
    const trimmedArtist = sanitizeMeta(artist, 500, true);
    const parsedYear    = year ? parseInt(year, 10) || null : null;

    // --- Дедупликация по Track: возвращаем "already done" запись в очереди ---
    const createInstantDone = async (existingTrackId: number, dupMethod: string) => {
      const now = new Date();
      // Добавляем трек в плейлист "Загруженное" пользователя
      if (currentUserId) {
        await addToUploadsPlaylist(prisma, currentUserId, existingTrackId);
      }
      const entry = await (prisma as any).uploadQueue.create({
        data: {
          filename: "__dup__",
          originalName: file.name,
          title: trimmedTitle,
          artist: trimmedArtist,
          fileHash,
          status: "done",
          trackId: existingTrackId,
          uploadedBy: currentUserId,
          startedAt: now,
          finishedAt: now,
        },
      });
      // Подтягиваем название трека для сообщения
      const existingTrack = await prisma.track.findUnique({
        where: { id: existingTrackId },
        select: { title: true, artist: true },
      });
      const trackLabel = existingTrack
        ? `${existingTrack.title}${existingTrack.artist ? ` — ${existingTrack.artist}` : ""}`
        : `#${existingTrackId}`;
      // Логируем дубликат в TrackLog
      await prisma.trackLog.create({
        data: {
          trackId: existingTrackId,
          userId: currentUserId,
          event: "upload_duplicate",
          details: {
            method: dupMethod,
            originalName: file.name,
            uploadedTitle: trimmedTitle,
            uploadedArtist: trimmedArtist,
          },
        },
      });
      return NextResponse.json({
        queued: true,
        queueId: entry.id,
        position: 0,
        duplicate: true,
        existingTrackId,
        message: `Трек уже в библиотеке: ${trackLabel}`,
      });
    };

    const hashDuplicate = await prisma.track.findFirst({ where: { fileHash } });
    if (hashDuplicate) return createInstantDone(hashDuplicate.id, "fileHash");

    if (trimmedTitle && trimmedArtist && parsedYear) {
      const metaDuplicate = await prisma.track.findFirst({
        where: { metaTitle: trimmedTitle, metaArtist: trimmedArtist, metaYear: parsedYear },
      });
      if (metaDuplicate) return createInstantDone(metaDuplicate.id, "meta");
    }
    const titleArtistDuplicate = await prisma.track.findFirst({
      where: { title: trimmedTitle, ...(trimmedArtist ? { artist: trimmedArtist } : { artist: null }) },
    });
    if (titleArtistDuplicate) return createInstantDone(titleArtistDuplicate.id, "titleArtist");

    // --- Дедупликация по UploadQueue (файл уже ждёт обработки) ---
    const queueHashDuplicate = await (prisma as any).uploadQueue.findFirst({
      where: { fileHash, status: { in: ["pending", "processing"] } },
    });
    if (queueHashDuplicate) {
      // Показываем как "уже в очереди" — тоже успех для пользователя
      return NextResponse.json({ queued: true, queueId: queueHashDuplicate.id, position: 1, message: "Уже в очереди" });
    }

    const titlePart = normalizeFilename(trimmedTitle || file.name.replace(/\.[^.]+$/, ""));
    const artistPart = trimmedArtist ? normalizeFilename(trimmedArtist) : "";
    const rawBase = (artistPart ? `${titlePart}-${artistPart}` : titlePart).slice(0, 200);
    const extFromName = (file.name.split(".").pop() || "mp3").toLowerCase();
    const fileExtension = /^[a-z0-9]+$/.test(extFromName) ? extFromName : "mp3";

    let fileName: string;

    if (isS3Enabled()) {
      // S3-режим: загружаем напрямую в бакет как queue/filename.mp3
      // Имя уникализируем через хэш чтобы не конфликтовало
      fileName = `${rawBase.slice(0, 180)}-${fileHash.slice(0, 8)}.${fileExtension}`;
      await uploadBuffer(buffer, `queue/${fileName}`);
      console.log(`[process-track] S3 queued: queue/${fileName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    } else {
      // Локальный режим: сохраняем в public/uploads/queue/
      const queueDir = join(process.cwd(), "public", "uploads", "queue");
      if (!existsSync(queueDir)) {
        await mkdir(queueDir, { recursive: true });
      }
      const unique = getUniqueFilePath(queueDir, rawBase, fileExtension);
      fileName = unique.fileName;
      await writeFile(unique.filePath, buffer);
      console.log(`[process-track] Local queued: ${fileName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    }

    // Создаём запись в очереди
    const entry = await (prisma as any).uploadQueue.create({
      data: {
        filename: fileName,
        originalName: file.name,
        title: trimmedTitle,
        artist: trimmedArtist,
        album: sanitizeMeta(album, 500, true),
        genre: sanitizeMeta(genre, 200),
        year: parsedYear,
        trackNumber: trackNumber ? parseInt(trackNumber, 10) || null : null,
        fileHash,
        status: "pending",
        uploadedBy: currentUserId,
      },
    });

    // Логируем новую загрузку
    await prisma.trackLog.create({
      data: {
        trackId: null,
        userId: currentUserId,
        event: "upload_new",
        details: {
          queueId: entry.id,
          originalName: file.name,
          title: trimmedTitle,
          artist: trimmedArtist,
          fileSize: file.size,
        },
      },
    });

    // Позиция в очереди
    const position = await (prisma as any).uploadQueue.count({
      where: { status: { in: ["pending", "processing"] } },
    });

    return NextResponse.json({
      queued: true,
      queueId: entry.id,
      position,
      message: `Трек добавлен в очередь (позиция #${position})`,
    });
  } catch (error: any) {
    console.error("[process-track] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to queue track" },
      { status: 500 },
    );
  }
}
