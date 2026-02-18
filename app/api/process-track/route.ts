import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, mkdirSync } from "fs";
import { randomUUID, createHash } from "crypto";
import { analyzeTrack, type AnalyzerType } from "@/lib/analyzeAudio";
import { analyzeGenre } from "@/lib/analyzeGenre";
import { requireAdmin } from "@/lib/auth";

const execAsync = promisify(exec);

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
    /** При загрузке используем только анализ v2 (ряды + мостики). Остальные отключены. */
    const analyzer = (formData.get("analyzer") as string) || "v2";
    const useV2 = analyzer === "v2";
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
        ...(trimmedArtist ? { artist: trimmedArtist } : { artist: null }),
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
    /** Полный результат v2 (для сохранения в отчёт — чтобы UI показывал те же квадраты, что и при загрузке) */
    let v2ReportResult: Record<string, unknown> | null = null;

    // ВСЕГДА анализируем аудио для получения gridMap, BPM и Offset
    // gridMap нужен для корректного отслеживания битов с учетом мостиков
    // Параллельно запускаем определение жанра
    let genreResult: {
      genre_hint: string;
      confidence: number;
      is_bachata_compatible: boolean;
    } | null = null;

    try {
      console.log("\n" + "=".repeat(80));
      console.log("Starting audio analysis (v2: rows + bridges)...");
      console.log(`Audio file: ${filePath}`);
      console.log("=".repeat(80) + "\n");

      if (useV2) {
        // Анализ v2: скрипт analyze-track-v2.py → gridMap с v2Layout и мостиками
        const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
        const scriptPath = join(
          process.cwd(),
          "scripts",
          "analyze-track-v2.py",
        );
        if (!existsSync(scriptPath)) {
          throw new Error("V2 analysis script not found: " + scriptPath);
        }
        const command = `"${pythonPath}" "${scriptPath}" "${filePath}"`;
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024,
          timeout: 300000,
        });
        if (stderr) console.log("[V2] stderr:", stderr);
        const result = JSON.parse(stdout.trim());
        if (result.error) throw new Error(result.error);

        finalBpm = result.bpm ?? 120;
        baseBpm = result.bpm ?? null;
        finalOffset = result.song_start_time ?? 0;
        baseOffset = result.song_start_time ?? null;
        const layout = Array.isArray(result.layout) ? result.layout : [];
        const bridges = Array.isArray(result.bridges) ? result.bridges : [];
        gridMap = {
          bpm: finalBpm,
          offset: finalOffset,
          grid: [],
          duration: result.duration ?? undefined,
          v2Layout: layout,
          bridges: bridges.map((b: { time_sec?: number }) => b.time_sec ?? 0),
        };
        v2ReportResult = result;
        console.log(
          `V2: BPM=${finalBpm}, offset=${finalOffset}s, layout segments=${layout.length}, bridges=${bridges.length}`,
        );
      } else {
        // Резерв: старый анализатор (basic), если когда-нибудь понадобится
        const analysisResult = await analyzeTrack(filePath, {
          analyzer: "basic",
          reportName: title,
        });
        finalBpm = analysisResult.bpm;
        baseBpm = analysisResult.bpm;
        finalOffset = analysisResult.offset;
        baseOffset = analysisResult.offset;
        if (analysisResult.gridMap) {
          gridMap = analysisResult.gridMap;
          if (analysisResult.duration)
            gridMap.duration = analysisResult.duration;
        }
      }

      // Жанр — параллельно с v2 не запускаем, чтобы не удваивать время; можно запустить после при желании
      const genreRes = await analyzeGenre(filePath).catch((err) => {
        console.warn("Genre detection failed (non-critical):", err.message);
        return null;
      });
      genreResult = genreRes;
      if (genreResult) {
        console.log(
          `Genre detected: ${genreResult.genre_hint} (confidence: ${(genreResult.confidence * 100).toFixed(0)}%)`,
        );
      }

      console.log("\n" + "=".repeat(80));
      console.log("Audio analysis completed successfully!");
      console.log("=".repeat(80) + "\n");
    } catch (error: any) {
      console.warn(
        "Audio analysis failed, using provided/default values:",
        error.message,
      );
      baseBpm = finalBpm;
      baseOffset = finalOffset;
    }

    // Подготавливаем метаданные для сохранения
    const metadata = {
      album: album || null,
      genre: genre || null,
      year: year || null,
      track: trackNumber || null,
      comment: comment || null,
      genreDetection: genreResult
        ? {
            hint: genreResult.genre_hint,
            confidence: genreResult.confidence,
            isBachataCompatible: genreResult.is_bachata_compatible,
          }
        : null,
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
        analyzerType: useV2 ? "v2" : "basic",
        fileHash: fileHash,
        genreHint: genreResult?.genre_hint || null,
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

    // Сохраняем полный отчёт v2 в тот же файл, откуда читает GET analyze-v2 — тогда квадраты/цвета в UI совпадают с загрузкой
    if (useV2 && v2ReportResult) {
      try {
        const audioBasename = fileName.replace(/\.[^.]+$/, "");
        const reportsDir = join(process.cwd(), "public", "uploads", "reports");
        if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
        const reportPath = join(
          reportsDir,
          `${audioBasename}_v2_analysis.json`,
        );
        const toSave = { success: true, trackId: track.id, ...v2ReportResult };
        writeFileSync(reportPath, JSON.stringify(toSave, null, 2));
        console.log("[process-track] V2 report saved: " + reportPath);
      } catch (e) {
        console.warn("[process-track] Failed to save V2 report:", e);
      }
    }

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
