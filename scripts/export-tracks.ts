/**
 * Скрипт для экспорта треков из базы данных
 * Выгружает: название песни, имя файла на сервере (filename), таблицу Row Analysis (из correlation).
 *
 * Использование:
 *   npx ts-node scripts/export-tracks.ts           # CSV в консоль
 *   npx ts-node scripts/export-tracks.ts --json    # JSON в консоль
 *   npx ts-node scripts/export-tracks.ts --file    # Сохранить в файл
 *
 * Или через tsx:
 *   npx tsx scripts/export-tracks.ts
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

type RowAnalysisRow = {
  count?: number;
  madmom_sum?: number;
  madmom_avg?: number;
  madmom_max?: number;
};
type RowAnalysis = Record<string, RowAnalysisRow>;
type Verdict = {
  winning_row?: number;
  start_time?: number;
  start_beat_id?: number;
};

function getRowAnalysisFromGridMap(gridMap: unknown): {
  row_analysis: RowAnalysis | null;
  verdict: Verdict | null;
} {
  if (!gridMap || typeof gridMap !== "object")
    return { row_analysis: null, verdict: null };
  const ca = (gridMap as Record<string, unknown>).correlationAnalysis;
  if (!ca || typeof ca !== "object")
    return { row_analysis: null, verdict: null };
  const ra = (ca as Record<string, unknown>).row_analysis;
  const v = (ca as Record<string, unknown>).verdict;
  return {
    row_analysis:
      ra && typeof ra === "object" && !Array.isArray(ra)
        ? (ra as RowAnalysis)
        : null,
    verdict:
      v && typeof v === "object" && !Array.isArray(v) ? (v as Verdict) : null,
  };
}

async function exportTracks() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const saveToFile = args.includes("--file");

  try {
    const tracks = await prisma.track.findMany({
      select: {
        id: true,
        title: true,
        artist: true,
        bpm: true,
        offset: true,
        baseBpm: true,
        baseOffset: true,
        filename: true,
        isProcessed: true,
        createdAt: true,
        gridMap: true,
      },
      orderBy: {
        title: "asc",
      },
    });

    console.log(`\n📊 Найдено треков: ${tracks.length}\n`);

    if (tracks.length === 0) {
      console.log("База данных пуста.");
      return;
    }

    const escapeCSV = (
      value: string | number | boolean | null | Date | undefined,
    ) => {
      if (value === null || value === undefined) return "";
      if (value instanceof Date) return value.toISOString();
      const str = String(value);
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const numForExcel = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined || v === "") return "";
      return "'" + String(v);
    };

    if (isJson) {
      const jsonData = {
        exported_at: new Date().toISOString(),
        total_tracks: tracks.length,
        tracks: tracks.map((track) => {
          const { row_analysis, verdict } = getRowAnalysisFromGridMap(
            track.gridMap,
          );
          return {
            id: track.id,
            title: track.title,
            filename: track.filename,
            artist: track.artist || "",
            bpm: track.bpm,
            offset: track.offset,
            baseBpm: track.baseBpm,
            baseOffset: track.baseOffset,
            isProcessed: track.isProcessed,
            createdAt: track.createdAt,
            row_analysis: row_analysis ?? undefined,
            row_analysis_verdict: verdict ?? undefined,
          };
        }),
      };

      const output = JSON.stringify(jsonData, null, 2);

      if (saveToFile) {
        const filename = `tracks_export_${new Date().toISOString().split("T")[0]}.json`;
        const filepath = path.join(
          process.cwd(),
          "public",
          "uploads",
          filename,
        );
        fs.writeFileSync(filepath, output, "utf-8");
        console.log(`✅ Сохранено в: ${filepath}`);
      } else {
        console.log(output);
      }
    } else {
      // CSV: один трек — одна строка. Колонки: Название | Сумма 1–8 | Среднее 1–8 | Выстрел 1–8 | Победитель | Файл (сервер)
      const rowKeys = [
        "row_1",
        "row_2",
        "row_3",
        "row_4",
        "row_5",
        "row_6",
        "row_7",
        "row_8",
      ] as const;
      const subHeaders = ["'1", "'2", "'3", "'4", "'5", "'6", "'7", "'8"];
      const headerRow1 = [
        "Название",
        ...Array(8).fill("Сумма"),
        ...Array(8).fill("Среднее"),
        ...Array(8).fill("Выстрел"),
        "Победитель",
        "Файл (сервер)",
      ].join(",");
      const headerRow2 = [
        "",
        ...subHeaders,
        ...subHeaders,
        ...subHeaders,
        "",
        "",
      ].join(",");

      const csvRows: string[] = [headerRow1, headerRow2];
      for (const track of tracks) {
        const { row_analysis, verdict } = getRowAnalysisFromGridMap(
          track.gridMap,
        );
        const title = escapeCSV(track.title);
        const filename = escapeCSV(track.filename);
        const winningRow = verdict?.winning_row ?? "";

        const sums = rowKeys.map((key) =>
          numForExcel(row_analysis?.[key]?.madmom_sum),
        );
        const avgs = rowKeys.map((key) =>
          numForExcel(row_analysis?.[key]?.madmom_avg),
        );
        const maxs = rowKeys.map((key) =>
          numForExcel(row_analysis?.[key]?.madmom_max),
        );

        csvRows.push(
          [
            title,
            ...sums,
            ...avgs,
            ...maxs,
            numForExcel(winningRow),
            filename,
          ].join(","),
        );
      }

      const csv = csvRows.join("\n");

      if (saveToFile) {
        const filename = `tracks_export_${new Date().toISOString().split("T")[0]}.csv`;
        const filepath = path.join(
          process.cwd(),
          "public",
          "uploads",
          filename,
        );
        fs.writeFileSync(filepath, "\uFEFF" + csv, "utf-8");
        console.log(`✅ Сохранено в: ${filepath}`);
      } else {
        console.log(csv);
      }

      console.log("\n--- Статистика ---");
      const bpms = tracks.map((t) => t.bpm).filter((b) => b > 0);
      if (bpms.length > 0) {
        console.log(
          `Средний BPM: ${Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)}`,
        );
        console.log(
          `Диапазон BPM: ${Math.min(...bpms)} - ${Math.max(...bpms)}`,
        );
      }
      console.log(
        `Обработано (stems): ${tracks.filter((t) => t.isProcessed).length} из ${tracks.length}`,
      );
    }
  } catch (error) {
    console.error("❌ Ошибка:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

exportTracks();
