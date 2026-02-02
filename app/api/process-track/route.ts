import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { randomUUID, createHash } from "crypto";
import { analyzeTrack, type AnalyzerType } from "@/lib/analyzeAudio";
import { requireAdmin } from "@/lib/auth";

// Настройки для работы с большими файлами и долгими операциями
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 минут таймаут для API route (Next.js 15)

// Максимальный размер файла: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
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
    const comment = formData.get("comment") as string | null;
    const analyzer = (formData.get("analyzer") as string) || "extended"; // 'basic' | 'extended' | 'correlation', по умолчанию расширенный
    const validAnalyzers: AnalyzerType[] = ["basic", "extended", "correlation"];
    const analyzerOption: AnalyzerType = validAnalyzers.includes(analyzer as AnalyzerType)
      ? (analyzer as AnalyzerType)
      : "extended";
    // BPM и Offset всегда определяются автоматически
    const autoBpm = true;
    const autoOffset = true;

    // Валидация
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    // Проверка типа файла
    if (
      !file.type.includes("audio") &&
      !file.name.toLowerCase().endsWith(".mp3")
    ) {
      return NextResponse.json(
        { error: "Only MP3 audio files are supported" },
        { status: 400 },
      );
    }

    // Проверка размера
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
        },
        { status: 400 },
      );
    }

    // Читаем файл в буфер
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Вычисляем MD5 хеш файла для проверки дубликатов
    const fileHash = createHash("md5").update(buffer).digest("hex");

    // Импортируем Prisma для проверки дубликатов
    const { prisma } = await import("@/lib/prisma");

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 },
      );
    }

    // --- Проверка дубликатов ---
    // 1. По MD5 хешу файла (точное совпадение)
    const hashDuplicate = await prisma.track.findFirst({
      where: { fileHash },
    });
    if (hashDuplicate) {
      return NextResponse.json(
        {
          error: "Этот файл уже загружен",
          duplicate: true,
          existingTrack: {
            id: hashDuplicate.id,
            title: hashDuplicate.title,
            artist: hashDuplicate.artist,
          },
        },
        { status: 409 },
      );
    }

    // 2. По title + artist (MySQL ci collation = case-insensitive)
    const trimmedTitle = title.trim();
    const trimmedArtist = artist?.trim() || null;

    const titleArtistDuplicate = await prisma.track.findFirst({
      where: {
        title: trimmedTitle,
        ...(trimmedArtist
          ? { artist: trimmedArtist }
          : { artist: null }),
      },
    });

    if (titleArtistDuplicate) {
      return NextResponse.json(
        {
          error: `Трек "${titleArtistDuplicate.title}" — ${titleArtistDuplicate.artist || "Unknown"} уже существует`,
          duplicate: true,
          existingTrack: {
            id: titleArtistDuplicate.id,
            title: titleArtistDuplicate.title,
            artist: titleArtistDuplicate.artist,
          },
        },
        { status: 409 },
      );
    }

    // Создаем директории, если их нет
    const uploadsDir = join(process.cwd(), "public", "uploads", "raw");

    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Генерируем уникальный идентификатор для трека
    const uniqueId = randomUUID();
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileExtension = safeFileName.split(".").pop() || "mp3";
    const fileName = `${uniqueId}.${fileExtension}`;
    const filePath = join(uploadsDir, fileName);

    console.log(`Processing track: ${title} by ${artist || "Unknown"}`);
    console.log(
      `File: ${fileName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
    );

    // Сохраняем файл
    await writeFile(filePath, buffer);

    console.log(`File saved: ${filePath}`);

    // Определяем BPM и Offset (всегда автоматически)
    let finalBpm = 120;
    let finalOffset = 0;
    let baseBpm: number | null = null;
    let baseOffset: number | null = null;
    let gridMap: any = null;

    // ВСЕГДА анализируем аудио для получения gridMap, BPM и Offset
    // gridMap нужен для корректного отслеживания битов с учетом мостиков
    try {
      console.log("\n" + "=".repeat(80));
      console.log("🎵 Starting audio analysis for GridMap, BPM and Offset...");
      console.log(`📁 Audio file: ${filePath}`);
      console.log("=".repeat(80) + "\n");

      // analyzer: basic = analyze-track.py, extended = analyze-track-improved.py
      const analysisResult = await analyzeTrack(filePath, {
        analyzer: analyzerOption,
      });

      console.log("\n" + "=".repeat(80));
      console.log("✅ Audio analysis completed successfully!");
      console.log("=".repeat(80) + "\n");

      // BPM и Offset всегда определяются автоматически
      finalBpm = analysisResult.bpm;
      baseBpm = analysisResult.bpm;
      console.log(`Auto-detected BPM: ${finalBpm}`);

      finalOffset = analysisResult.offset;
      baseOffset = analysisResult.offset;
      console.log(`Auto-detected Offset: ${finalOffset}s`);

      // ВСЕГДА сохраняем gridMap (если доступен) - он нужен для beat tracking
      if (analysisResult.gridMap) {
        gridMap = analysisResult.gridMap;
        // Сохраняем duration в gridMap для использования при генерации beatGrid
        if (analysisResult.duration) {
          gridMap.duration = analysisResult.duration;
        }
        console.log(
          `Detected gridMap with ${analysisResult.gridMap.grid.length} sections, duration: ${analysisResult.duration || "unknown"}s`,
        );
      } else {
        console.warn("GridMap not available in analysis result");
      }
    } catch (error: any) {
      console.warn(
        "Audio analysis failed, using provided/default values:",
        error.message,
      );
      // Если анализ не удался, используем введенные значения как базовые
      baseBpm = finalBpm;
      baseOffset = finalOffset;
      // gridMap останется null - будет использован линейный beat tracking
    }

    // Подготавливаем метаданные для сохранения
    const metadata = {
      album: album || null,
      genre: genre || null,
      year: year || null,
      track: trackNumber || null,
      comment: comment || null,
    };

    // Создаем запись в БД
    const track = await prisma.track.create({
      data: {
        title: title,
        artist: artist || null,
        filename: fileName, // Для совместимости со старой схемой
        bpm: finalBpm,
        offset: finalOffset,
        baseBpm: baseBpm,
        baseOffset: baseOffset,
        isFree: true,
        pathOriginal: `/uploads/raw/${fileName}`,
        pathVocals: null, // Будет заполнено после обработки через Demucs
        pathDrums: null,
        pathBass: null,
        pathOther: null,
        isProcessed: false, // Трек еще не разложен на стемы
        analyzerType: analyzerOption,
        fileHash: fileHash,
        gridMap: gridMap
          ? JSON.parse(
              JSON.stringify({
                ...gridMap,
                metadata: metadata, // Сохраняем метаданные в gridMap
              }),
            )
          : { metadata: metadata }, // Если нет gridMap, создаем объект с метаданными
      },
    });

    return NextResponse.json({
      success: true,
      track: track,
      message: "Track processed successfully",
    });
  } catch (error: any) {
    console.error("Error processing track:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to process track",
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
