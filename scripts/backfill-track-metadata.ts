/**
 * Скрипт заполнения duration и fileSize для существующих треков.
 * Запуск: npx tsx scripts/backfill-track-metadata.ts
 */
import { PrismaClient } from "@prisma/client";
import { stat } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const prisma = new PrismaClient();
const publicDir = join(process.cwd(), "public");

async function main() {
  const tracks = await prisma.track.findMany({
    select: {
      id: true,
      pathOriginal: true,
      filename: true,
      duration: true,
      fileSize: true,
    },
  });

  console.log(`Total tracks: ${tracks.length}`);
  let updatedDuration = 0;
  let updatedFileSize = 0;
  let errors = 0;

  for (const track of tracks) {
    const updates: { duration?: number; fileSize?: bigint } = {};

    const filePath = track.pathOriginal || track.filename;
    const localPath = filePath.startsWith("/")
      ? join(publicDir, filePath)
      : join(publicDir, filePath);

    // fileSize
    if (track.fileSize == null && existsSync(localPath)) {
      try {
        const st = await stat(localPath);
        updates.fileSize = BigInt(st.size);
      } catch {}
    }

    // duration из v2_analysis.json
    if (track.duration == null && track.pathOriginal) {
      const basename = track.pathOriginal
        .replace(/^.*[\\/]/, "")
        .replace(/\.[^.]+$/, "");
      const reportPath = join(
        publicDir,
        "uploads",
        "reports",
        `${basename}_v2_analysis.json`
      );
      if (existsSync(reportPath)) {
        try {
          const report = JSON.parse(readFileSync(reportPath, "utf-8"));
          if (typeof report.duration === "number") {
            updates.duration = report.duration;
          }
        } catch {}
      }
    }

    if (Object.keys(updates).length > 0) {
      try {
        await prisma.track.update({
          where: { id: track.id },
          data: updates,
        });
        if (updates.duration != null) updatedDuration++;
        if (updates.fileSize != null) updatedFileSize++;
      } catch (e: any) {
        errors++;
        console.error(`Track #${track.id}: ${e.message}`);
      }
    }
  }

  console.log(`Done. Duration: ${updatedDuration}, FileSize: ${updatedFileSize}, Errors: ${errors}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
