import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/tracks/[id]/analyze-v2
 * Returns saved v2 analysis results if available.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) {
      return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) {
      return NextResponse.json({ found: false });
    }

    const audioBasename = pathOriginal
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_v2_analysis.json`,
    );

    if (!existsSync(resultPath)) {
      return NextResponse.json({ found: false });
    }

    const data = JSON.parse(readFileSync(resultPath, "utf-8"));

    // Подставляем название и исполнителя из БД, если в отчёте их нет (старые отчёты)
    const payload: Record<string, unknown> = {
      ...data,
      ...(data.track_title == null && { track_title: track.title }),
      ...(data.track_artist == null &&
        track.artist != null && { track_artist: track.artist }),
    };

    // Вычисляем % превосходства из Row Analysis
    let rowDominancePercent: number | undefined;
    const rowAnalysis = data.row_analysis as
      | Record<string, { madmom_sum?: number }>
      | undefined;
    if (rowAnalysis && typeof rowAnalysis === "object") {
      const r1 =
        (rowAnalysis["row_1"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_2"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_3"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_4"]?.madmom_sum ?? 0);
      const r5 =
        (rowAnalysis["row_5"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_6"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_7"]?.madmom_sum ?? 0) +
        (rowAnalysis["row_8"]?.madmom_sum ?? 0);
      if (r5 > 0) {
        rowDominancePercent = Math.round(((r1 - r5) / r5) * 100 * 100) / 100;
      }
    }

    if (rowDominancePercent != null && prisma) {
      const existingGridMap = (track.gridMap as Record<string, unknown>) || {};
      await prisma.track.update({
        where: { id: trackId },
        data: {
          gridMap: {
            ...existingGridMap,
            rowDominancePercent,
          } as object,
        },
      });
    }

    return NextResponse.json({
      found: true,
      ...payload,
      ...(rowDominancePercent != null && { rowDominancePercent }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/tracks/[id]/analyze-v2
 * Runs v2 analysis (row dominance + bridge detection).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) {
      return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not configured" },
        { status: 500 },
      );
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const pathOriginal = track.pathOriginal;
    if (!pathOriginal) {
      return NextResponse.json(
        { error: "Track has no original file path" },
        { status: 400 },
      );
    }

    const relativePath = pathOriginal.replace(/^\//, "");
    const filePath = join(process.cwd(), "public", relativePath);
    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: "Original audio file not found on disk" },
        { status: 404 },
      );
    }

    const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
    const scriptPath = join(process.cwd(), "scripts", "analyze-track-v2.py");

    if (!existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "V2 analysis script not found" },
        { status: 500 },
      );
    }

    console.log(`[V2 Analysis] Running: "${pythonPath}" "${scriptPath}" "${filePath}"`);

    const encoder = new TextEncoder();
    const existingGridMap = (track.gridMap as Record<string, unknown>) || {};
    const audioBasename = pathOriginal
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");
    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_v2_analysis.json`,
    );

    const stream = new ReadableStream({
      start(controller) {
        const send = (obj: object) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(obj)}\n\n`),
          );
        };

        const proc = spawn(pythonPath, [scriptPath, filePath]);
        let stdoutBuf = "";
        let stderrBuf = "";

        proc.stderr.on("data", (chunk: Buffer) => {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split("\n");
          stderrBuf = lines.pop() ?? "";
          for (const line of lines) {
            const t = line.trim();
            if (t) {
              console.log(`[V2 Analysis] ${t}`);
              send({ type: "log", message: t });
            }
          }
        });

        proc.stdout.on("data", (chunk: Buffer) => {
          stdoutBuf += chunk.toString();
        });

        proc.on("close", (code) => {
          (async () => {
            try {
              // Flush remaining stderr
              if (stderrBuf.trim()) {
                console.log(`[V2 Analysis] ${stderrBuf.trim()}`);
                send({ type: "log", message: stderrBuf.trim() });
              }
              if (code !== 0) {
                throw new Error(`Python exited with code ${code}`);
              }
              const result = JSON.parse(stdoutBuf.trim());
              if (result.error) throw new Error(result.error);

              const toSave = {
                success: true,
                trackId,
                track_title: track.title,
                track_artist: track.artist ?? null,
                ...result,
              };
              writeFileSync(resultPath, JSON.stringify(toSave, null, 2));
              console.log("[V2 Analysis] Results saved: " + resultPath);

              const v2LayoutRms = Array.isArray(result.layout)
                ? result.layout
                : [];
              const v2LayoutPerc = Array.isArray(result.layout_perc)
                ? result.layout_perc
                : [];
              const v2BridgesTimes = (
                v2LayoutPerc.length > 1 ? v2LayoutPerc : v2LayoutRms
              )
                .slice(1)
                .map((s: { time_start?: number }) => s.time_start ?? 0);
              const squareAnalysis = result.square_analysis as
                | { verdict?: string; row_dominance_pct?: number }
                | undefined;
              const rowDominancePercent =
                typeof squareAnalysis?.row_dominance_pct === "number"
                  ? squareAnalysis.row_dominance_pct
                  : undefined;

              const mergedGridMap = {
                ...existingGridMap,
                bpm: result.bpm ?? track.bpm ?? existingGridMap.bpm,
                offset:
                  result.song_start_time ??
                  track.offset ??
                  existingGridMap.offset,
                duration: result.duration ?? existingGridMap.duration,
                v2Layout: v2LayoutPerc,
                v2LayoutRms,
                v2LayoutPerc,
                // Анализ прошёл успешно → всегда перезаписываем мостики результатом анализа
                // [] = нет мостиков — это тоже валидный результат (skip_bridges=True)
                bridges: v2BridgesTimes,
                ...(rowDominancePercent != null && { rowDominancePercent }),
                rowSwapped: result.row_swapped ?? false,
              };

              if (prisma) {
                await prisma.track.update({
                  where: { id: trackId },
                  data: {
                    gridMap: mergedGridMap as object,
                    analyzerType: "v2",
                    ...(result.song_start_time != null && {
                      offset: result.song_start_time,
                      baseOffset: result.song_start_time,
                    }),
                  },
                });
              }
              console.log(
                `[V2 Analysis] gridMap updated (perc=${v2LayoutPerc.length}, rms=${v2LayoutRms.length})`,
              );

              send({ type: "result", data: toSave });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              console.error("[V2 Analysis] Error:", msg);
              send({ type: "error", message: msg });
            } finally {
              controller.close();
            }
          })();
        });

        proc.on("error", (err) => {
          console.error("[V2 Analysis] Spawn error:", err);
          send({ type: "error", message: err.message });
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[V2 Analysis] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
