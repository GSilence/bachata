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

    // CSV: таблица как на сайте — одна строка заголовка, затем по 8 строк на трек (ряды 1–8)
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
    const csvHeader = [
      "Название",
      "Row",
      "Beats",
      "Sum",
      "Avg",
      "Max",
      "Победитель",
      "Verdict_Offset_s",
      "Verdict_StartBeatId",
      "Файл (сервер)",
    ].join(",");

    const csvRows: string[] = [];
    for (let t = 0; t < tracks.length; t++) {
      const track = tracks[t];
      const { row_analysis, verdict } = getRowAnalysisFromGridMap(
        track.gridMap,
      );
      const title = escapeCSV(track.title);
      const filename = escapeCSV(track.filename);
      const winningRow = verdict?.winning_row ?? null;
      const offsetS = verdict?.start_time ?? "";
      const startBeatId = verdict?.start_beat_id ?? "";

      for (let i = 0; i < rowKeys.length; i++) {
        const key = rowKeys[i];
        const rowNum = i + 1;
        const row = row_analysis?.[key];
        const isWinner = winningRow !== null && winningRow === rowNum;
        const winnerMark = isWinner ? "<<" : "";
        const rowOffset = isWinner ? String(offsetS) : "";
        const rowStartBeat = isWinner ? String(startBeatId) : "";

        csvRows.push(
          [
            title,
            rowNum,
            row?.count ?? "",
            row?.madmom_sum ?? "",
            row?.madmom_avg ?? "",
            row?.madmom_max ?? "",
            winnerMark,
            rowOffset,
            rowStartBeat,
            filename,
          ].join(","),
        );
      }
      if (t < tracks.length - 1) csvRows.push("");
    }

    const csv = [csvHeader, ...csvRows].join("\n");
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
