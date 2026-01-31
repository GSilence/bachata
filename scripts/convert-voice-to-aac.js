/**
 * Конвертирует voice counting файлы в AAC (M4A) для оптимальной работы на мобильных
 *
 * AAC преимущества:
 * - Аппаратное декодирование на всех мобильных устройствах
 * - Отличное качество при меньшем размере (128kbps)
 * - Меньше нагрузка на CPU → меньше artifacts
 * - 44.1kHz sample rate (нативный для большинства мобильных → нет resampling)
 *
 * Использование:
 *   node scripts/convert-voice-to-aac.js
 *
 * Требует: ffmpeg в PATH
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const inputDir = path.join(__dirname, '..', 'public', 'audio', 'voice');
const outputDir = path.join(__dirname, '..', 'public', 'audio', 'voice-aac');

// Создаем выходную папку
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('Converting voice files to AAC (M4A) 44.1kHz...\n');

for (let i = 1; i <= 8; i++) {
  // Пробуем найти исходный файл (MP3 или WAV)
  let inputFile = path.join(inputDir, `${i}.mp3`);
  if (!fs.existsSync(inputFile)) {
    inputFile = path.join(inputDir, `${i}.wav`);
  }

  const outputFile = path.join(outputDir, `${i}.m4a`);

  if (!fs.existsSync(inputFile)) {
    console.warn(`⚠️  File not found: ${i}.mp3 or ${i}.wav`);
    continue;
  }

  try {
    console.log(`Converting ${path.basename(inputFile)} → ${i}.m4a...`);

    // Конвертируем в AAC с параметрами:
    // -ar 44100: Sample rate 44.1kHz (нативный для большинства мобильных)
    // -ac 1: Mono
    // -c:a aac: Кодек AAC
    // -b:a 128k: Bitrate 128kbps (отличное качество для голоса)
    // БЕЗ фильтров - чистая конвертация оригинала
    const cmd = `ffmpeg -y -i "${inputFile}" -ar 44100 -ac 1 -c:a aac -b:a 128k "${outputFile}"`;

    execSync(cmd, { stdio: 'pipe' });

    const stats = fs.statSync(outputFile);
    console.log(`✓ Created ${i}.m4a (${Math.round(stats.size / 1024)} KB)\n`);
  } catch (error) {
    console.error(`✗ Failed to convert ${path.basename(inputFile)}:`, error.message);
  }
}

console.log('\n✅ Conversion complete!');
console.log(`Output directory: ${outputDir}`);
console.log('\nNext steps:');
console.log('1. Listen to the M4A files to verify quality');
console.log('2. If good, copy them to public/audio/voice/ (backup old files first)');
console.log('3. Update audioEngine.ts to use .m4a extension instead of .wav');
