/**
 * Creates public/audio/silent-anchor.mp3 (60s silent, 44.1kHz mono).
 * Used for background playback: the browser keeps the media session alive.
 *
 * Requires ffmpeg: ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 60 -q:a 9 -ac 1 -y out.mp3
 *
 * Run: node scripts/create-silent-anchor.js
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");

const outDir = path.join(__dirname, "..", "public", "audio");
const outFile = path.join(outDir, "silent-anchor.mp3");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

try {
  // Windows: escape double quotes in path for shell
  const outArg = outFile.replace(/"/g, '\\"');
  execSync(
    `ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 60 -q:a 9 -ac 1 -y "${outArg}"`,
    { stdio: "inherit" },
  );
  console.log("Created:", outFile);
} catch (e) {
  console.error(
    "ffmpeg not found or failed. Create the file manually:\n  ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 60 -q:a 9 -ac 1 -y public/audio/silent-anchor.mp3",
  );
  process.exit(1);
}
