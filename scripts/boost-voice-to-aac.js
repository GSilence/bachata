/**
 * Конвертирует voice counting файлы в AAC (M4A) с увеличением громкости
 *
 * Использование:
 *   node scripts/boost-voice-to-aac.js [input-dir] [output-dir] [volume-db]
 *
 * Примеры:
 *   node scripts/boost-voice-to-aac.js public/audio/voice/en
 *   node scripts/boost-voice-to-aac.js public/audio/voice/pt public/audio/voice/pt 6
 *
 * Параметры:
 *   input-dir  — папка с исходными файлами (по умолчанию: public/audio/voice/en)
 *   output-dir — папка для результата (по умолчанию: та же, что input-dir)
 *   volume-db  — усиление в dB (по умолчанию: 6, т.е. примерно x2 громкости)
 *
 * Требует: ffmpeg в PATH
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const inputDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'public', 'audio', 'voice', 'en'));
const outputDir = path.resolve(process.argv[3] || inputDir);
const volumeDb = parseFloat(process.argv[4] || '6');

// Создаем выходную папку
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Временная папка если input === output (чтобы не перезаписывать исходники на лету)
const needTempDir = path.resolve(inputDir) === path.resolve(outputDir);
const tempDir = needTempDir ? path.join(outputDir, '_temp_boost') : outputDir;

if (needTempDir && !fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

console.log(`Input:  ${inputDir}`);
console.log(`Output: ${outputDir}`);
console.log(`Volume: +${volumeDb} dB`);
console.log('');

const converted = [];

for (let i = 1; i <= 8; i++) {
  // Ищем исходный файл: m4a, mp3 или wav
  let inputFile = null;
  for (const ext of ['m4a', 'mp3', 'wav']) {
    const candidate = path.join(inputDir, `${i}.${ext}`);
    if (fs.existsSync(candidate)) {
      inputFile = candidate;
      break;
    }
  }

  if (!inputFile) {
    console.warn(`  Skip ${i}: not found (m4a/mp3/wav)`);
    continue;
  }

  const outputFile = path.join(needTempDir ? tempDir : outputDir, `${i}.m4a`);

  try {
    // -af volume=+NdB: увеличить громкость
    // -ar 44100: Sample rate 44.1kHz
    // -ac 1: Mono
    // -c:a aac -b:a 128k: AAC 128kbps
    const cmd = `ffmpeg -y -i "${inputFile}" -af "volume=${volumeDb}dB" -ar 44100 -ac 1 -c:a aac -b:a 128k "${outputFile}"`;
    execSync(cmd, { stdio: 'pipe' });

    const stats = fs.statSync(outputFile);
    console.log(`  ${path.basename(inputFile)} -> ${i}.m4a (${Math.round(stats.size / 1024)} KB, +${volumeDb}dB)`);
    converted.push(i);
  } catch (error) {
    console.error(`  Failed ${path.basename(inputFile)}: ${error.message}`);
  }
}

// Если работали во временной папке — переносим результат
if (needTempDir && converted.length > 0) {
  for (const i of converted) {
    const src = path.join(tempDir, `${i}.m4a`);
    const dst = path.join(outputDir, `${i}.m4a`);
    fs.copyFileSync(src, dst);
  }
  fs.rmSync(tempDir, { recursive: true });
}

console.log(`\nDone: ${converted.length} files converted.`);
