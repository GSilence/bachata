import { NextResponse } from "next/server";

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
  diff_percent?: number;
  avg_energy_all?: number;
  avg_energy_strong_rows?: number;
  potential_bridges?: number;
  potential_breaks?: number;
  stable_sections?: number;
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") || "csv";

    const { prisma } = await import("@/lib/prisma");

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

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

    // Префикс ' заставляет Excel показывать значение как текст (без преобразования в дату)
    const numForExcel = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined || v === "") return "";
      return "'" + String(v);
    };

    if (format === "json") {
      const payload = {
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
      return NextResponse.json(payload, {
        headers: {
          "Content-Disposition": `attachment; filename="tracks_export_${new Date().toISOString().split("T")[0]}.json"`,
        },
      });
    }

    // CSV: один трек — одна строка. Колонки как на картинке: Название | Сумма 1–8 | Среднее 1–8 | Выстрел 1–8 | Победитель | Файл (сервер)
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
      "Diff%",
      "Avg Energy",
      "Avg Strong",
      "Bridges",
      "Breaks",
      "Stable",
      ...Array(8).fill("Среднее"),
      ...Array(8).fill("Выстрел"),
      "Победитель",
      "Файл (сервер)",
    ].join(",");
    const headerRow2 = [
      "",
      ...subHeaders,
      "",
      "",
      "",
      "",
      "",
      "",
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
      const diffPercent = numForExcel(verdict?.diff_percent);
      const avgEnergyAll = numForExcel(verdict?.avg_energy_all);
      const avgEnergyStrong = numForExcel(verdict?.avg_energy_strong_rows);
      const bridges = numForExcel(verdict?.potential_bridges);
      const breaks = numForExcel(verdict?.potential_breaks);
      const stable = numForExcel(verdict?.stable_sections);
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
          diffPercent,
          avgEnergyAll,
          avgEnergyStrong,
          bridges,
          breaks,
          stable,
          ...avgs,
          ...maxs,
          numForExcel(winningRow),
          filename,
        ].join(","),
      );
    }

    const csv = csvRows.join("\n");
    const bom = "\uFEFF";

    return new NextResponse(bom + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tracks_export_${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Error exporting tracks:", error);
    return NextResponse.json(
      { error: "Failed to export tracks" },
      { status: 500 },
    );
  }
}
