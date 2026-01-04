import type { Beat, GridMap } from "@/types";

/**
 * Generates a fallback beat grid for standard 1-8 cycle
 * This is used when the Python analyzer doesn't detect bridges yet
 *
 * @param bpm - Beats per minute
 * @param offset - Offset in seconds (when the first beat occurs)
 * @param duration - Track duration in seconds
 * @returns Beat[] array with pre-calculated beats
 */
export function generateFallbackBeatGrid(
  bpm: number,
  offset: number,
  duration: number
): Beat[] {
  const beatGrid: Beat[] = [];

  // Calculate beat interval in seconds
  // Each beat is 1/4 of a measure, so beat interval = 60 / bpm / 4 = 60 / (bpm * 4)
  // Actually, for Bachata, we typically have 4 beats per measure, so:
  // beat interval = 60 / bpm (one beat per second at 60 bpm)
  // But we want quarter notes, so: beat interval = 60 / bpm
  const beatInterval = 60 / bpm;

  // Generate beats for the entire duration
  let beatNumber = 1;
  let time = offset;

  while (time <= duration) {
    beatGrid.push({
      time: time,
      number: beatNumber,
      hasVoice: true, // All beats have voice by default (can be filtered later)
    });

    // Move to next beat
    time += beatInterval;

    // Cycle through 1-8
    beatNumber = (beatNumber % 8) + 1;
  }

  return beatGrid;
}

/**
 * Generates beat grid based on downbeats and grid sections from madmom analysis
 * This is the preferred method for maximum accuracy
 *
 * Strategy:
 * 1. Use downbeats (сильные доли) as the primary reference
 * 2. In Bachata: downbeats correspond to counts 1, 3, 5, 7 (every other beat)
 * 3. Between downbeats, add intermediate beats (2, 4, 6, 8)
 * 4. Use grid sections (Verse/Bridge) as checkpoints - each section start should be beat 1
 *
 * IMPORTANT: This function works with ANY values returned by madmom:
 * - Any number of downbeats (not just 265)
 * - Any number of sections (not just 16 bridge + 15 verse)
 * - Any BPM value (not just 124)
 * - Any offset value (not just 0.21s)
 * - Any downbeats-to-beats ratio (works even if not exactly 2:1)
 *
 * @param gridMap - GridMap with downbeats and sections from madmom analysis
 * @param duration - Track duration in seconds
 * @returns Beat[] array with pre-calculated beats based on downbeats
 */
export function generateBeatGridFromDownbeats(
  gridMap: GridMap,
  duration: number
): Beat[] {
  const beatGrid: Beat[] = [];

  // Если нет downbeats, используем fallback
  if (!gridMap.downbeats || gridMap.downbeats.length === 0) {
    console.warn("No downbeats in gridMap, using fallback beat grid");
    return generateFallbackBeatGrid(gridMap.bpm, gridMap.offset, duration);
  }

  let downbeats = gridMap.downbeats;
  const sections = gridMap.grid || [];
  const bpm = gridMap.bpm;

  // Интервал между beats = 60 / bpm
  const beatInterval = 60 / bpm;
  // Ожидаемый интервал между downbeats (каждый второй beat) = 2 * beatInterval
  const expectedDownbeatInterval = 2 * beatInterval;

  // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Фильтруем downbeats, если madmom определил их слишком часто
  // В бачате downbeats должны быть каждый второй beat, а не каждый beat
  // Если интервалы между downbeats слишком короткие (< 1.5 * beatInterval),
  // значит madmom определил слишком много downbeats, и нужно фильтровать их
  if (downbeats.length > 1) {
    const firstInterval = downbeats[1] - downbeats[0];
    const threshold = 1.5 * beatInterval; // Порог для определения "слишком частых" downbeats

    if (firstInterval < threshold) {
      console.warn(
        `[BeatGrid] Downbeats are too frequent (interval: ${firstInterval.toFixed(
          3
        )}s, expected: ${expectedDownbeatInterval.toFixed(
          3
        )}s). Filtering to every other downbeat.`
      );

      // Фильтруем downbeats, оставляя только каждый второй
      // Простой подход: если интервалы слишком короткие, оставляем каждый второй downbeat
      const filteredDownbeats: number[] = [downbeats[0]]; // Всегда оставляем первый

      // Вычисляем средний интервал между downbeats
      const intervals: number[] = [];
      for (let i = 1; i < Math.min(10, downbeats.length); i++) {
        intervals.push(downbeats[i] - downbeats[i - 1]);
      }
      const avgInterval =
        intervals.length > 0
          ? intervals.reduce((a, b) => a + b, 0) / intervals.length
          : firstInterval;

      // Если средний интервал меньше порога, значит downbeats слишком частые
      // Оставляем каждый второй downbeat
      if (avgInterval < threshold) {
        for (let i = 2; i < downbeats.length; i += 2) {
          filteredDownbeats.push(downbeats[i]);
        }
      } else {
        // Если интервалы нормальные, оставляем все downbeats
        filteredDownbeats.push(...downbeats.slice(1));
      }

      console.log(
        `[BeatGrid] Filtered ${downbeats.length} downbeats to ${filteredDownbeats.length} downbeats`
      );
      downbeats = filteredDownbeats;
    }
  }

  // Создаем Set для быстрого поиска начал секций
  const sectionStarts = new Set<number>();
  for (const section of sections) {
    sectionStarts.add(section.start);
  }

  // Генерируем beats на основе downbeats
  // В бачате: downbeats = счеты 1, 3, 5, 7 (каждый второй beat)
  // Между downbeats добавляем промежуточные beats (2, 4, 6, 8)

  let beatNumber = 1; // Текущий счет (1-8)

  for (let i = 0; i < downbeats.length; i++) {
    const downbeatTime = downbeats[i];

    // Проверяем, начинается ли новая секция на этом downbeat
    const isSectionStart = Array.from(sectionStarts).some(
      (start) => Math.abs(start - downbeatTime) < 0.2
    );

    // Если начинается новая секция, сбрасываем счетчик на 1
    if (isSectionStart) {
      beatNumber = 1;
    }

    // Downbeat всегда нечетный счет (1, 3, 5, 7)
    // Если текущий счет четный, делаем его нечетным
    if (beatNumber % 2 === 0) {
      beatNumber = (beatNumber - 1) % 8 || 1;
    }

    // Добавляем downbeat
    beatGrid.push({
      time: downbeatTime,
      number: beatNumber,
      hasVoice: true,
    });

    // Добавляем промежуточный beat между downbeats (если есть следующий downbeat)
    // В бачате между downbeats (1, 3, 5, 7) должны быть промежуточные beats (2, 4, 6, 8)
    if (i < downbeats.length - 1) {
      const nextDownbeatTime = downbeats[i + 1];
      const intermediateTime = downbeatTime + beatInterval;

      // Проверяем, что промежуточный beat находится между текущим и следующим downbeat
      // и не выходит за границы трека
      if (
        intermediateTime < nextDownbeatTime - 0.05 &&
        intermediateTime <= duration
      ) {
        const intermediateNumber = (beatNumber % 8) + 1;
        beatGrid.push({
          time: intermediateTime,
          number: intermediateNumber,
          hasVoice: true,
        });
      }
    } else {
      // Если это последний downbeat, добавляем промежуточный beat после него
      // (если не выходим за границы трека)
      const intermediateTime = downbeatTime + beatInterval;
      if (intermediateTime <= duration) {
        const intermediateNumber = (beatNumber % 8) + 1;
        beatGrid.push({
          time: intermediateTime,
          number: intermediateNumber,
          hasVoice: true,
        });
      }
    }

    // Обновляем счетчик для следующего downbeat
    // Следующий downbeat будет через 2 beats (1->3, 3->5, 5->7, 7->1)
    beatNumber = (beatNumber + 2) % 8 || 1;
  }

  // Сортируем по времени
  beatGrid.sort((a, b) => a.time - b.time);

  // Проверка: если beatGrid пустой или слишком короткий, используем fallback
  if (beatGrid.length === 0) {
    console.warn("[BeatGrid] Generated beatGrid is empty, using fallback");
    return generateFallbackBeatGrid(bpm, gridMap.offset || 0, duration);
  }

  // Проверка: если beatGrid слишком короткий (меньше 10 beats на минуту трека), используем fallback
  const expectedMinBeats = Math.floor((duration / 60) * bpm);
  if (beatGrid.length < expectedMinBeats * 0.5) {
    console.warn(
      `[BeatGrid] Generated beatGrid is too short (${beatGrid.length} beats, expected ~${expectedMinBeats}), using fallback`
    );
    return generateFallbackBeatGrid(bpm, gridMap.offset || 0, duration);
  }

  // Финальная корректировка: убеждаемся, что каждая ДОСТАТОЧНО ДЛИННАЯ секция начинается с 1
  // Игнорируем микро-секции (короче 4 beats) - они не должны вызывать коррекцию
  const MIN_SECTION_BEATS = 4; // Минимальная длина секции для коррекции

  for (const section of sections) {
    // Пропускаем микро-секции
    if (section.beats < MIN_SECTION_BEATS) {
      continue; // Не корректируем микро-секции
    }

    const sectionStart = section.start;
    const tolerance = 0.2;

    // Находим ближайший beat к началу секции
    const beatAtStart = beatGrid.find(
      (beat) => Math.abs(beat.time - sectionStart) < tolerance
    );

    if (beatAtStart && beatAtStart.number !== 1) {
      // Корректируем: реальная секция (достаточно длинная) должна начинаться с 1
      const sectionEnd = sectionStart + section.beats * beatInterval;
      const sectionBeats = beatGrid.filter(
        (beat) =>
          beat.time >= sectionStart - tolerance &&
          beat.time <= sectionEnd + tolerance
      );

      // Пересчитываем beats в секции, начиная с 1
      let beatNum = 1;
      for (const beat of sectionBeats.sort((a, b) => a.time - b.time)) {
        if (beat.time >= sectionStart - tolerance) {
          beat.number = beatNum;
          beatNum = (beatNum % 8) + 1;
        }
      }
    }
  }

  console.log(
    `[BeatGrid] Generated ${beatGrid.length} beats for duration ${duration}s (BPM: ${bpm})`
  );
  if (beatGrid.length > 0) {
    console.log(
      `[BeatGrid] First beat: time=${beatGrid[0].time.toFixed(3)}s, number=${
        beatGrid[0].number
      }`
    );
    console.log(
      `[BeatGrid] Last beat: time=${beatGrid[beatGrid.length - 1].time.toFixed(
        3
      )}s, number=${beatGrid[beatGrid.length - 1].number}`
    );
  }

  return beatGrid;
}
