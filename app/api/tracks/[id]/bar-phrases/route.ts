import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/tracks/[id]/bar-phrases
 * Возвращает сохранённые результаты анализа баров.
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
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    const audioBasename = (track.pathOriginal ?? "")
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");

    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_bar_phrases.json`,
    );

    if (!existsSync(resultPath)) {
      return NextResponse.json({ found: false });
    }

    const data = JSON.parse(readFileSync(resultPath, "utf-8"));
    return NextResponse.json({ found: true, ...data });
  } catch (error) {
    console.error("Bar phrases GET error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/**
 * POST /api/tracks/[id]/bar-phrases
 * Запускает analyze_bar_phrases.py и сохраняет результат.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin(request);

  try {
    const { id } = await params;
    const trackId = parseInt(id, 10);
    if (isNaN(trackId)) {
      return NextResponse.json({ error: "Invalid track ID" }, { status: 400 });
    }

    if (!prisma) {
      return NextResponse.json({ error: "Database not configured" }, { status: 500 });
    }

    const track = await prisma.track.findUnique({ where: { id: trackId } });
    if (!track || !track.pathOriginal) {
      return NextResponse.json({ error: "Track not found or no audio file" }, { status: 404 });
    }

    const audioPath = join(process.cwd(), "public", track.pathOriginal.replace(/^\//, ""));
    if (!existsSync(audioPath)) {
      return NextResponse.json({ error: "Audio file not found on disk" }, { status: 404 });
    }

    const audioBasename = track.pathOriginal
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");

    const v2JsonPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_v2_analysis.json`,
    );

    const resultPath = join(
      process.cwd(),
      "public",
      "uploads",
      "reports",
      `${audioBasename}_bar_phrases.json`,
    );

    const scriptPath = join(process.cwd(), "scripts", "analyze_bar_phrases.py");
    const pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";

    const v2Arg = existsSync(v2JsonPath) ? `"${v2JsonPath}"` : "";
    const command = `"${pythonPath}" "${scriptPath}" "${audioPath}" ${v2Arg}`;

    let stdout = "";
    let stderr = "";
    try {
      ({ stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024,
        timeout: 280000,
      }));
    } catch (execErr: unknown) {
      // execAsync бросает при ненулевом exit code, но stdout/stderr всё равно есть
      const e = execErr as { stdout?: string; stderr?: string; message?: string };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? "";
      console.error("[bar-phrases] exec error:", e.message);
    }

    if (stderr) {
      console.log("[bar-phrases] stderr:", stderr.slice(-3000));
    }

    if (!stdout.trim()) {
      return NextResponse.json(
        { error: "Python script produced no output", stderr: stderr.slice(-1000) },
        { status: 500 },
      );
    }

    const result = JSON.parse(stdout);
    writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf-8");

    return NextResponse.json({ found: true, ...result });
  } catch (error) {
    console.error("Bar phrases POST error:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
