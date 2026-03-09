/**
 * Воркер очереди загрузки треков.
 *
 * Запуск локально:  npm run worker
 * На Ubuntu:        systemctl start bachata-worker
 *
 * Алгоритм:
 *  1. Берёт первую запись UploadQueue со статусом "pending" (по createdAt)
 *  2. Помечает "processing"
 *  3. Запускает analyze-track-v2.py + analyzeGenre
 *  4. Создаёт Track в БД, переносит файл queue/ → raw/
 *  5. Помечает "done" (или "failed")
 *  6. Повторяет. При отсутствии задач — ждёт 5 сек.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, copyFileSync, rmSync, statSync } from "fs";
import { join } from "path";
import { uploadFile, isS3Enabled, getFileUrl, downloadFile, deleteFile as deleteS3File } from "../lib/storage";

const execAsync = promisify(exec);

// ─── Env ───────────────────────────────────────────────────────────────────

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("##")) continue;
      const [key, ...rest] = trimmed.split("=");
      if (!key) continue;
      const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
      process.env[key.trim()] = value;
    }
  } catch {}
}

// Сначала .env (базовые), потом .env.local (перезаписывает — приоритет выше)
loadEnvFile(join(process.cwd(), ".env"));
loadEnvFile(join(process.cwd(), ".env.local"));

const PYTHON = (process.env.DEMUCS_PYTHON_PATH || "python").trim().replace(/^["']|["']$/g, "");
const CWD    = process.cwd();
const POLL_INTERVAL_MS = 5_000;

// ─── Prisma ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// ─── Graceful shutdown ─────────────────────────────────────────────────────

let shuttingDown = false;
process.on("SIGTERM", () => { console.log("[worker] SIGTERM received, finishing current job…"); shuttingDown = true; });
process.on("SIGINT",  () => { console.log("[worker] SIGINT received, finishing current job…");  shuttingDown = true; });

// ─── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function log(...args: unknown[]) {
  console.log(`[worker] ${new Date().toISOString()}`, ...args);
}

// ─── Core: обработка одного трека ──────────────────────────────────────────

async function processEntry(entry: any) {
  // ── Дедупликация перед анализом ──────────────────────────────────────────
  // Повторно проверяем, не появился ли такой трек пока файл ждал в очереди
  const linkToExisting = async (existingTrackId: number) => {
    if (entry.uploadedBy) {
      await prisma.userTrack.upsert({
        where: { userId_trackId: { userId: entry.uploadedBy, trackId: existingTrackId } },
        update: {},
        create: { userId: entry.uploadedBy, trackId: existingTrackId },
      });
    }
    log(`Dedup: entry #${entry.id} → existing Track #${existingTrackId}`);
    return existingTrackId;
  };

  // По fileHash
  if (entry.fileHash) {
    const hashDup = await prisma.track.findFirst({ where: { fileHash: entry.fileHash } });
    if (hashDup) return linkToExisting(hashDup.id);
  }

  // По title+artist
  if (entry.title) {
    const titleArtistDup = await prisma.track.findFirst({
      where: { title: entry.title, ...(entry.artist ? { artist: entry.artist } : { artist: null }) },
    });
    if (titleArtistDup) return linkToExisting(titleArtistDup.id);
  }

  const s3Mode = isS3Enabled();

  // В S3-режиме — скачиваем файл из S3 во временную папку для анализа
  // В локальном режиме — берём из queue/ напрямую
  const tempDir = join(CWD, "public", "uploads", "queue");
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const queueFilePath = join(tempDir, entry.filename);

  if (s3Mode) {
    log(`Downloading from S3: queue/${entry.filename}`);
    await downloadFile(`queue/${entry.filename}`, queueFilePath);
    log(`Downloaded to temp: ${queueFilePath}`);
  } else {
    if (!existsSync(queueFilePath)) {
      throw new Error(`Queue file not found: ${queueFilePath}`);
    }
  }

  // Сохраняем размер файла ДО анализа и возможного удаления temp-файла
  const fileSizeBytes = existsSync(queueFilePath) ? BigInt(statSync(queueFilePath).size) : null;

  const scriptPath = join(CWD, "scripts", "analyze-track-v2.py");
  if (!existsSync(scriptPath)) throw new Error("analyze-track-v2.py not found");

  // ── Анализ v2 ──────────────────────────────────────────────────────────
  log(`Running v2 analysis: ${entry.filename}`);
  const { stdout, stderr } = await execAsync(
    `"${PYTHON}" "${scriptPath}" "${queueFilePath}"`,
    { maxBuffer: 10 * 1024 * 1024, timeout: 300_000, env: { ...process.env, NUMBA_DISABLE_JIT: "1" } },
  );
  if (stderr) log("v2 stderr:", stderr.slice(0, 500));

  let result = JSON.parse(stdout.trim());
  if (result.error) throw new Error(`v2: ${result.error}`);

  // Попса: v2 вернул redirect → запускаем специализированный анализатор
  if (result.popsa_redirect === true) {
    log("Popsa detected by v2 → running analyze-popsa.py…");
    const popsaScript = join(CWD, "scripts", "analyze-popsa.py");
    if (!existsSync(popsaScript)) throw new Error("analyze-popsa.py not found");
    const { stdout: popsaOut, stderr: popsaErr } = await execAsync(
      `"${PYTHON}" "${popsaScript}" "${queueFilePath}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 300_000, env: { ...process.env, NUMBA_DISABLE_JIT: "1" } },
    );
    if (popsaErr) log("popsa stderr:", popsaErr.slice(0, 500));
    const popsaResult = JSON.parse(popsaOut.trim());
    if (popsaResult.error) throw new Error(`popsa: ${popsaResult.error}`);
    result = popsaResult;
  }

  // Определяем, является ли трек "попсой" (не бачатой по структуре пиков)
  // Не отклоняем — добавляем в библиотеку со статусом "popsa" для фильтрации модераторами
  let isPopsa = result.track_type === "popsa" || result.peaks_per_octave === 4;
  const verdict      = result.row_analysis_verdict;
  const winningRows  = Array.isArray(verdict?.winning_rows) ? verdict.winning_rows : null;
  if (!isPopsa && winningRows && winningRows.length === 2) {
    const a = Number(winningRows[0]);
    const b = Number(winningRows[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const distance = (Math.max(a, b) - Math.min(a, b) + 8) % 8;
      if (distance !== 4) isPopsa = true;
    }
  }
  if (isPopsa) log("Track flagged as popsa — will be added with status 'popsa'");

  const finalBpm     = result.bpm ?? 120;
  const finalOffset  = result.song_start_time ?? 0;
  const layout       = Array.isArray(result.layout) ? result.layout : [];
  const v2LayoutRms  = layout;
  const v2LayoutPerc = Array.isArray(result.layout_perc) ? result.layout_perc : [];
  const v2BridgesTimes = (v2LayoutPerc.length > 1 ? v2LayoutPerc : v2LayoutRms)
    .slice(1)
    .map((s: any) => s.time_start ?? 0);

  // madmom_diff_pct — основной источник rowDominancePercent (та же формула что в analyze-v2 и UI)
  const rowDominancePercent: number | null =
    typeof result.madmom_diff_pct === "number" ? result.madmom_diff_pct : null;

  // ── Жанр ──────────────────────────────────────────────────────────────
  log("Running genre analysis…");
  let genreResult: { genre_hint: string; confidence: number; is_bachata_compatible: boolean } | null = null;
  try {
    const genreScript = join(CWD, "scripts", "analyze-genre.py");
    const { stdout: gs } = await execAsync(
      `"${PYTHON}" "${genreScript}" "${queueFilePath}"`,
      { maxBuffer: 5 * 1024 * 1024, timeout: 120_000 },
    );
    const gr = JSON.parse(gs.trim());
    if (!gr.error) genreResult = gr;
  } catch (e: any) {
    log("Genre failed (non-critical):", e.message);
  }

  // ── Финализируем файл: S3 или локально ────────────────────────────────
  const s3Key = `raw/${entry.filename}`;

  if (s3Mode) {
    // S3: загружаем temp-файл в raw/, удаляем temp и queue/ из S3
    log(`Uploading to S3: ${s3Key}`);
    await uploadFile(queueFilePath, s3Key);
    log(`S3 upload done: ${s3Key}`);
    try { rmSync(queueFilePath); } catch {}  // удаляем temp
    try { await deleteS3File(`queue/${entry.filename}`); } catch {}  // удаляем из S3 queue/
    log(`Deleted from S3 queue: queue/${entry.filename}`);
  } else {
    // Локально: переносим queue/ → raw/
    const rawDir = join(CWD, "public", "uploads", "raw");
    if (!existsSync(rawDir)) mkdirSync(rawDir, { recursive: true });
    const rawFilePath = join(rawDir, entry.filename);
    try {
      renameSync(queueFilePath, rawFilePath);
    } catch {
      if (existsSync(queueFilePath)) {
        copyFileSync(queueFilePath, rawFilePath);
        rmSync(queueFilePath);
      } else if (!existsSync(rawFilePath)) {
        throw new Error(`File disappeared during move: ${queueFilePath}`);
      }
    }
    log(`Moved → raw/${entry.filename}`);
  }

  // ── Создаём Track ────────────────────────────────────────────────────
  const gridMap: Record<string, unknown> = {
    bpm: finalBpm,
    offset: finalOffset,
    grid: [],
    duration: result.duration ?? undefined,
    v2Layout: v2LayoutPerc,
    v2LayoutRms,
    v2LayoutPerc,
    bridges: v2BridgesTimes,
    ...(rowDominancePercent != null && { rowDominancePercent }),
    ...(verdict?.row_one != null && { row_one: verdict.row_one }),
    ...(Array.isArray(verdict?.winning_rows) && verdict.winning_rows.length >= 2 && {
      winning_rows: verdict.winning_rows,
    }),
  };

  const track = await prisma.track.create({
    data: {
      title:       entry.title,
      artist:      entry.artist || null,
      filename:    entry.filename,
      bpm:         finalBpm,
      offset:      finalOffset,
      baseBpm:     finalBpm,
      baseOffset:  finalOffset,
      isFree:      true,
      pathOriginal: getFileUrl(s3Key),
      isProcessed:  false,
      analyzerType: "v2",
      fileHash:     entry.fileHash,
      genreHint:    genreResult?.genre_hint || null,
      metaTitle:    entry.title || null,
      metaArtist:   entry.artist || null,
      metaAlbum:    entry.album || null,
      metaYear:     entry.year || null,
      metaGenre:    entry.genre || null,
      metaTrackNum: entry.trackNumber || null,
      hasBridges:   v2BridgesTimes.length > 0,
      trackStatus:  isPopsa ? "popsa" : "unlistened",
      gridMap:      gridMap as object,
      ...(rowDominancePercent != null && { rowDominancePercent }),
      ...(typeof result.duration === "number" && { duration: result.duration }),
      ...(fileSizeBytes != null && { fileSize: fileSizeBytes }),
    },
  });

  // ── UserTrack: связываем трек с загрузившим пользователем ─────────────
  if (entry.uploadedBy) {
    await (prisma as any).userTrack.upsert({
      where: { userId_trackId: { userId: entry.uploadedBy, trackId: track.id } },
      update: {},
      create: { userId: entry.uploadedBy, trackId: track.id },
    });
    log(`UserTrack created: user #${entry.uploadedBy} → track #${track.id}`);
  }

  // ── Сохраняем JSON-отчёт ─────────────────────────────────────────────
  const reportsDir = join(CWD, "public", "uploads", "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const reportBaseName = entry.filename.replace(/\.[^.]+$/, "");
  const reportPath = join(reportsDir, `${reportBaseName}_v2_analysis.json`);
  writeFileSync(reportPath, JSON.stringify({ success: true, trackId: track.id, track_title: track.title, track_artist: track.artist ?? null, ...result }, null, 2));

  // ── ModQueue + TrackLog ──────────────────────────────────────────────
  if (!isPopsa) {
    try {
      await prisma.modQueue.create({ data: { trackId: track.id } });
    } catch {
      // Игнорируем (unique constraint если уже есть)
    }
  }
  try {
    await prisma.trackLog.create({
      data: {
        trackId: track.id,
        event: "analyzer_done",
        details: { title: track.title, artist: track.artist ?? null, trackStatus: isPopsa ? "popsa" : "unlistened" },
      },
    });
  } catch {
    // Не критично
  }

  log(`Done: Track #${track.id} "${track.title}"`);
  return track.id;
}

// ─── Main loop ─────────────────────────────────────────────────────────────

async function run() {
  log("Queue worker started. Python:", PYTHON);
  log("Polling every", POLL_INTERVAL_MS / 1000, "sec…");

  while (!shuttingDown) {
    // Берём первую pending-запись
    const entry = await prisma.uploadQueue.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });

    if (!entry) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    log(`Processing queue entry #${entry.id}: "${entry.title}"`);

    // Помечаем как обрабатываемый
    await prisma.uploadQueue.update({
      where: { id: entry.id },
      data: { status: "processing", startedAt: new Date() },
    });

    try {
      const trackId = await processEntry(entry);
      await prisma.uploadQueue.update({
        where: { id: entry.id },
        data: { status: "done", trackId, finishedAt: new Date() },
      });
      log(`Entry #${entry.id} → done (Track #${trackId})`);
    } catch (err: any) {
      log(`Entry #${entry.id} → FAILED:`, err.message);
      // НЕ удаляем файл из queue/ — он нужен для повторной попытки (retry).
      // Файл будет удалён только при успешной обработке (move queue/ → raw/).
      await prisma.uploadQueue.update({
        where: { id: entry.id },
        data: { status: "failed", error: err.message, finishedAt: new Date() },
      });
    }

    // Короткая пауза между задачами, чтобы не молотить CPU
    if (!shuttingDown) await sleep(1_000);
  }

  log("Worker stopped.");
  await prisma.$disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("[worker] Fatal:", err);
  process.exit(1);
});
