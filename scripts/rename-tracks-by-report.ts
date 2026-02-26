#!/usr/bin/env npx tsx
/**
 * Переименование треков по реальным названиям из отчётов v2.
 *
 * Ожидаемая структура:
 *   <basePath>/
 *     tracks/   — аудиофайлы с именами-хешами (uuid.mp3, uuid.wav, ...)
 *     rep/      — отчёты {uuid}_v2_analysis.json (в JSON есть trackId, опционально track_title/track_artist)
 *
 * Скрипт для каждого отчёта находит трек по uuid, берёт название из JSON или из БД по trackId,
 * и переименовывает файл в "Artist - Title.ext" (или "Title.ext", если нет artist).
 *
 * Запуск:
 *   npx tsx scripts/rename-tracks-by-report.ts [basePath] [--dry-run]
 *   basePath по умолчанию: public/uploads/test  (или public/uploads/test/bridges)
 */

import { join } from "path";
import { readdirSync, readFileSync, renameSync, existsSync } from "fs";
import { prisma } from "../lib/prisma";

const BASE_PATH_DEFAULT = join(process.cwd(), "public", "uploads", "test");
const REP_FOLDER_NAMES = ["reports", "rep"]; // проверяем обе варианта имени
const TRACKS_FOLDER = "tracks";
const REPORT_SUFFIX = "_v2_analysis.json";

// Запрещённые символы в имени файла (Windows + общие)
const INVALID_CHARS = /[\\/:*?"<>|]/g;

function sanitizeFileName(name: string): string {
  return name.replace(INVALID_CHARS, "_").trim() || "unnamed";
}

function extractUuidFromReportFilename(filename: string): string | null {
  if (!filename.endsWith(REPORT_SUFFIX)) return null;
  return filename.slice(0, -REPORT_SUFFIX.length);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const basePathArg = args.find((a) => !a.startsWith("--"));
  const basePath = basePathArg
    ? join(process.cwd(), basePathArg)
    : BASE_PATH_DEFAULT;

  const repDir = REP_FOLDER_NAMES.map((name) => join(basePath, name)).find(
    (p) => existsSync(p)
  );
  const tracksDir = join(basePath, TRACKS_FOLDER);

  if (!repDir) {
    console.error(
      `Папка отчётов не найдена (искал: ${REP_FOLDER_NAMES.join(" или ")} в ${basePath})`
    );
    process.exit(1);
  }
  if (!existsSync(tracksDir)) {
    console.error(`Папка треков не найдена: ${tracksDir}`);
    process.exit(1);
  }

  const reportFiles = readdirSync(repDir).filter((f) =>
    f.endsWith(REPORT_SUFFIX)
  );
  const trackFiles = readdirSync(tracksDir);

  console.log(`Базовая папка: ${basePath}`);
  console.log(`Отчётов: ${reportFiles.length}, файлов в tracks: ${trackFiles.length}`);
  if (dryRun) console.log("Режим --dry-run: переименование не выполняется.\n");

  let renamed = 0;
  let skipped = 0;
  let errors = 0;

  for (const reportFile of reportFiles) {
    const uuid = extractUuidFromReportFilename(reportFile);
    if (!uuid) continue;

    const reportPath = join(repDir, reportFile);
    let title: string;
    let artist: string | null = null;

    try {
      const raw = readFileSync(reportPath, "utf-8");
      const data = JSON.parse(raw) as {
        trackId?: number;
        track_title?: string;
        track_artist?: string | null;
      };

      if (data.track_title != null && data.track_title !== "") {
        title = String(data.track_title);
        artist = data.track_artist != null ? String(data.track_artist) : null;
      } else if (data.trackId != null && prisma) {
        const track = await prisma.track.findUnique({
          where: { id: Number(data.trackId) },
          select: { title: true, artist: true },
        });
        if (!track) {
          console.warn(`  [skip] ${reportFile}: trackId ${data.trackId} не найден в БД`);
          skipped++;
          continue;
        }
        title = track.title;
        artist = track.artist;
      } else {
        console.warn(`  [skip] ${reportFile}: нет track_title и нет trackId/БД`);
        skipped++;
        continue;
      }
    } catch (e) {
      console.error(`  [error] ${reportFile}: ${e}`);
      errors++;
      continue;
    }

    const displayName =
      artist && artist.trim() !== ""
        ? `${sanitizeFileName(artist)} - ${sanitizeFileName(title)}`
        : sanitizeFileName(title);

    const trackFile = trackFiles.find((f) => {
      const base = f.replace(/\.[^.]+$/, "");
      return base === uuid;
    });

    if (!trackFile) {
      console.warn(`  [skip] ${reportFile}: нет файла трека с basename ${uuid}`);
      skipped++;
      continue;
    }

    const ext = trackFile.replace(/^.*\./, "") || "mp3";
    const newName = `${displayName}.${ext}`;
    const oldPath = join(tracksDir, trackFile);
    const newPath = join(tracksDir, newName);

    if (oldPath === newPath || trackFile === newName) {
      skipped++;
      continue;
    }

    if (existsSync(newPath)) {
      console.warn(`  [skip] ${trackFile} -> ${newName}: целевой файл уже существует`);
      skipped++;
      continue;
    }

    try {
      if (!dryRun) renameSync(oldPath, newPath);
      console.log(`  ${trackFile} -> ${newName}`);
      renamed++;
    } catch (e) {
      console.error(`  [error] ${trackFile} -> ${newName}: ${e}`);
      errors++;
    }
  }

  console.log(
    `\nГотово. Переименовано: ${renamed}, пропущено: ${skipped}, ошибок: ${errors}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
