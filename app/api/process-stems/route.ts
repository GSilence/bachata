import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { runDemucs } from "@/lib/demucs";
import { requireAdmin } from "@/lib/auth";

// Настройки для работы с большими файлами и долгими операциями
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 минут таймаут для API route (Next.js 15)

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const trackId = body.trackId as number | undefined;

    if (!trackId) {
      return NextResponse.json(
        { error: "trackId is required" },
        { status: 400 }
      );
    }

    // Импортируем Prisma динамически
    const { prisma } = await import("@/lib/prisma");

    if (!prisma) {
      return NextResponse.json(
        { error: "Database not available" },
        { status: 500 }
      );
    }

    // Находим трек в БД
    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      return NextResponse.json({ error: "Track not found" }, { status: 404 });
    }

    // Проверяем, не обработан ли уже трек
    if (track.isProcessed) {
      return NextResponse.json({
        success: true,
        track: track,
        message: "Track already processed",
      });
    }

    // Проверяем наличие оригинального файла
    if (!track.pathOriginal) {
      return NextResponse.json(
        { error: "Original file path not found" },
        { status: 400 }
      );
    }

    // Получаем полный путь к файлу
    const filePath = join(process.cwd(), "public", track.pathOriginal);

    if (!existsSync(filePath)) {
      return NextResponse.json(
        { error: "Original file not found on disk" },
        { status: 404 }
      );
    }

    console.log(`Processing stems for track: ${track.title} (ID: ${trackId})`);
    console.log(`File: ${filePath}`);

    // Создаем директорию для стемов, если её нет
    const stemsDir = join(process.cwd(), "public", "uploads", "stems");
    if (!existsSync(stemsDir)) {
      await mkdir(stemsDir, { recursive: true });
    }

    // Извлекаем uniqueId из pathOriginal (например, /uploads/raw/uuid.mp3)
    const fileName = track.pathOriginal.split("/").pop() || "";
    const uniqueId = fileName.split(".").slice(0, -1).join("."); // Убираем расширение

    // Запускаем Demucs
    console.log("Starting Demucs processing...");
    const stemsResult = await runDemucs(filePath, stemsDir, uniqueId);
    console.log("Demucs processing completed");

    // Обновляем трек в БД
    const updatedTrack = await prisma.track.update({
      where: { id: trackId },
      data: {
        pathVocals: stemsResult.vocals,
        pathDrums: stemsResult.drums,
        pathBass: stemsResult.bass,
        pathOther: stemsResult.other,
        isProcessed: true,
      },
    });

    return NextResponse.json({
      success: true,
      track: updatedTrack,
      message: "Stems processed successfully",
    });
  } catch (error: any) {
    console.error("Error processing stems:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to process stems",
        details:
          process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
