import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { analyzeGenre } from "@/lib/analyzeGenre";
import { requireAdmin } from "@/lib/auth";

const execAsync = promisify(exec);

// Настройки для работы с большими файлами и долгими операциями
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 минут таймаут для API route (Next.js 15)

// Максимальный размер файла: 25MB
const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Нормализация для имени файла: нижний регистр, слова через дефис, только ASCII (a-z, 0-9, -). */
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
    // Только безопасный ASCII — без сломанной кодировки и странных символов (ð, ï и т.д.)
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

    // Проверка типа файла: только аудио, без видео
    const lowerName = file.name.toLowerCase();
    const videoExtensions = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".wmv", ".flv", ".ogv"];
    const isVideoByExt = videoExtensions.some((ext) => lowerName.endsWith(ext));
    const isVideoByMime = file.type.startsWith("video/");
    if (isVideoByExt || isVideoByMime) {
      return NextResponse.json(
        { error: "Загрузка видео запрещена. Разрешены только аудиофайлы." },
        { status: 400 },
      );
    }
    const allowedAudioExtensions = [".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac"];
    const hasAudioExt = allowedAudioExtensions.some((ext) => lowerName.endsWith(ext));
    const isAudioByMime = file.type.startsWith("audio/");
    if (!hasAudioExt && !isAudioByMime) {
      return NextResponse.json(
        { error: "Разрешены только аудиофайлы (MP3, M4A, WAV и т.д.)." },
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
    const dupResponse = (existing: { id: number; title: string; artist: string | null }, reason: string) =>
      NextResponse.json(
        {
          error: reason,
          duplicate: true,
          existingTrack: { id: existing.id, title: existing.title, artist: existing.artist },
        },
        { status: 409 },
      );

    // 1. По MD5 хешу — побайтово одинаковый файл
    const hashDuplicate = await prisma.track.findFirst({ where: { fileHash } });
    if (hashDuplicate) {
      return dupResponse(hashDuplicate, "Этот файл уже загружен (совпадение по содержимому)");
    }

    const trimmedTitle  = title.trim();
    const trimmedArtist = artist?.trim() || null;
    const parsedYear    = year ? parseInt(year, 10) || null : null;

    // 2. По metaTitle + metaArtist + metaYear — тот же трек из другого источника/рипа
    //    Срабатывает только если все три поля присутствуют в загрузке
    if (trimmedTitle && trimmedArtist && parsedYear) {
      const metaDuplicate = await prisma.track.findFirst({
        where: {
          metaTitle:  trimmedTitle,
          metaArtist: trimmedArtist,
          metaYear:   parsedYear,
        },
      });
      if (metaDuplicate) {
        return dupResponse(
          metaDuplicate,
          `Трек "${metaDuplicate.title}" — ${metaDuplicate.artist || "Unknown"} (${parsedYear}) уже есть в базе`,
        );
      }
    }

    // 3. По title + artist — fallback, когда мета-поля в БД могут быть пустыми
    const titleArtistDuplicate = await prisma.track.findFirst({
      where: {
        title: trimmedTitle,
        ...(trimmedArtist ? { artist: trimmedArtist } : { artist: null }),
      },
    });
    if (titleArtistDuplicate) {
      return dupResponse(
        titleArtistDuplicate,
        `Трек "${titleArtistDuplicate.title}" — ${titleArtistDuplicate.artist || "Unknown"} уже существует`,
      );
    }

    // Создаем директории, если их нет
    const uploadsDir = join(process.cwd(), "public", "uploads", "raw");

    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true });
    }

    // Имя файла: название-трека-имя-автора (оба нормализованы, через дефис)
    const titlePart = trimmedTitle
      ? normalizeFilename(trimmedTitle)
      : normalizeFilename(file.name.replace(/\.[^.]+$/, ""));
    const artistPart = trimmedArtist ? normalizeFilename(trimmedArtist) : "";
    const rawBase = (artistPart ? `${titlePart}-${artistPart}` : titlePart).slice(0, 200);
    const extFromName = (file.name.split(".").pop() || "mp3").toLowerCase();
    const fileExtension = /^[a-z0-9]+$/.test(extFromName) ? extFromName : "mp3";
    const { filePath, fileName } = getUniqueFilePath(uploadsDir, rawBase, fileExtension);

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

        // Не загружаем треки, не являющиеся бачатой: 4 пика (попса) или расстояние между сильными рядами ≠ 4 бита
        if (result.track_type === "popsa" || result.peaks_per_octave === 4) {
          await rm(filePath).catch(() => {});
          return NextResponse.json(
            { error: "Трек не является Бачатой" },
            { status: 400 },
          );
        }
        const verdict = result.row_analysis_verdict;
        const winningRows = Array.isArray(verdict?.winning_rows) ? verdict.winning_rows : null;
        if (winningRows && winningRows.length === 2) {
          const a = Number(winningRows[0]);
          const b = Number(winningRows[1]);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            const distance = (Math.max(a, b) - Math.min(a, b) + 8) % 8;
            if (distance !== 4) {
              await rm(filePath).catch(() => {});
              return NextResponse.json(
                { error: "Трек не является Бачатой" },
                { status: 400 },
              );
            }
          }
        }

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

    // Создаем запись в БД (минимальный gridMap; для v2 сразу перезапишем как у кнопки «Анализ v2»)
    const track = await prisma.track.create({
      data: {
        title: title,
        artist: artist || null,
        filename: fileName,
        bpm: finalBpm,
        offset: finalOffset,
        baseBpm: baseBpm,
        baseOffset: baseOffset,
        isFree: true,
        pathOriginal: `/uploads/raw/${fileName}`,
        pathVocals: null,
        pathDrums: null,
        pathBass: null,
        pathOther: null,
        isProcessed: false,
        analyzerType: useV2 ? "v2" : "basic",
        fileHash: fileHash,
        genreHint: genreResult?.genre_hint || null,
        // Метаданные из ID3-тегов → выделенные колонки БД
        metaTitle: title || null,
        metaArtist: artist?.trim() || null,
        metaAlbum: album?.trim() || null,
        metaYear: year ? parseInt(year, 10) || null : null,
        metaGenre: genre?.trim() || null,
        metaComment: comment?.trim() || null,
        metaTrackNum: trackNumber ? parseInt(trackNumber, 10) || null : null,
        gridMap:
          gridMap != null
            ? JSON.parse(JSON.stringify({ ...gridMap, metadata }))
            : { metadata },
      },
    });

    // Для v2: делаем 1 в 1 то же, что кнопка «Запустить анализ v2» — обновляем gridMap и сохраняем отчёт
    if (useV2 && v2ReportResult) {
      const result = v2ReportResult as Record<string, unknown>;
      const existingGridMap = (track.gridMap as Record<string, unknown>) || {};
      const v2LayoutRms = Array.isArray(result.layout) ? result.layout : [];
      const v2LayoutPerc = Array.isArray(result.layout_perc) ? result.layout_perc : [];
      // Визуальные маркеры мостиков = начала сегментов перцептивной (активной) раскладки
      const v2BridgesTimes = (v2LayoutPerc.length > 1 ? v2LayoutPerc : v2LayoutRms)
        .slice(1)
        .map((s: unknown) => (s as { time_start?: number }).time_start ?? 0);
      const squareAnalysis = result.square_analysis as
        | { verdict?: string; row_dominance_pct?: number }
        | undefined;
      const verdict = result.row_analysis_verdict as
        | { row_one?: number; winning_rows?: number[]; winning_row?: number }
        | undefined;
      const rowDominancePercent =
        typeof squareAnalysis?.row_dominance_pct === "number"
          ? squareAnalysis.row_dominance_pct
          : undefined;
      const mergedGridMap = {
        ...existingGridMap,
        bpm: (result.bpm as number) ?? track.bpm ?? existingGridMap.bpm,
        offset: result.song_start_time ?? track.baseOffset ?? track.offset ?? existingGridMap.offset,
        duration: (result.duration as number) ?? existingGridMap.duration,
        v2Layout: v2LayoutPerc,       // активная сетка = Perceptual по умолчанию
        v2LayoutRms,                  // RMS сетка
        v2LayoutPerc,                 // перцептивная сетка
        bridges: v2BridgesTimes,
        ...(rowDominancePercent != null && { rowDominancePercent }),
        ...(verdict?.row_one != null && { row_one: verdict.row_one }),
        ...(Array.isArray(verdict?.winning_rows) && verdict.winning_rows.length >= 2 && {
          winning_rows: verdict.winning_rows,
        }),
      };
      await prisma.track.update({
        where: { id: track.id },
        data: {
          gridMap: mergedGridMap as object,
          hasBridges: v2BridgesTimes.length > 0,
          ...(result.song_start_time != null && {
            baseOffset: result.song_start_time as number,
            offset: result.song_start_time as number,
          }),
        },
      });

      const audioBasename = fileName.replace(/\.[^.]+$/, "");
      const reportsDir = join(process.cwd(), "public", "uploads", "reports");
      if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
      const reportPath = join(reportsDir, `${audioBasename}_v2_analysis.json`);
      const toSave = {
        success: true,
        trackId: track.id,
        track_title: track.title,
        track_artist: track.artist ?? null,
        ...v2ReportResult,
      };
      writeFileSync(reportPath, JSON.stringify(toSave, null, 2));
      console.log("[process-track] V2: gridMap updated and report saved");

      // Возвращаем трек с актуальным gridMap (как после кнопки «Анализ v2»)
      const updatedTrack = await prisma.track.findUnique({
        where: { id: track.id },
      });
      return NextResponse.json({
        success: true,
        track: updatedTrack ?? track,
        message: "Track processed successfully",
      });
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
