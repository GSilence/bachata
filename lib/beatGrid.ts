import type { Beat, GridMap, GridSection } from "@/types";

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
  duration: number,
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
 * Generates beat grid using "Master Grid + Labeling" approach
 *
 * Strategy:
 * 1. Generate a perfect metronome skeleton (Master Grid) based on BPM and offset
 *    - Time between beats is ALWAYS constant (60 / bpm)
 *    - No gaps, no jumps, no "sticking"
 * 2. Label beats with numbers (1-8) based on grid sections
 *    - Find nearest beat to each section.start
 *    - Reset to "1" at section boundaries
 *    - Continue counting (2, 3, 4, 5, 6, 7, 8, 1...) within each section
 *
 * Key rules:
 * - NEVER change beat.time from skeleton (ensures perfect rhythm)
 * - NEVER remove beats (except those beyond track duration)
 * - If section starts "between" beats - attach to nearest existing beat
 *
 * @param gridMap - GridMap with sections from madmom/Librosa analysis
 * @param duration - Track duration in seconds
 * @returns Beat[] array with perfect metronome timing and section-based numbering
 */
export function generateBeatGridFromDownbeats(
  gridMap: GridMap,
  duration: number,
): Beat[] {
  const bpm = gridMap.bpm;
  const offset = gridMap.offset || 0;
  const bridges = gridMap.bridges || [];

  // Интервал между beats = 60 / bpm (константа для идеального метронома)
  const beatInterval = 60 / bpm;

  // Секции строим ТОЛЬКО из ручных бриджей (секции анализатора не используем для нумерации)
  const sections: GridSection[] = [];
  for (const bridgeTime of bridges) {
    sections.push({ type: "bridge", start: bridgeTime, beats: 4 });
    sections.push({
      type: "verse",
      start: bridgeTime + 4 * beatInterval,
      beats: 8,
    });
  }

  // ============================================
  // ШАГ 1: ГЕНЕРАЦИЯ СКЕЛЕТА (Master Grid)
  // ============================================
  // Создаем идеальный метроном без залипаний и скачков
  const skeletonBeats: Beat[] = [];
  let time = offset;
  let beatIndex = 0;

  while (time <= duration) {
    skeletonBeats.push({
      time: time,
      number: 1, // Временное значение, будет переопределено на шаге 2
      hasVoice: true,
    });

    beatIndex++;
    time = offset + beatIndex * beatInterval;
  }

  // Проверка: если скелет пустой, используем fallback
  if (skeletonBeats.length === 0) {
    return generateFallbackBeatGrid(bpm, offset, duration);
  }

  // ============================================
  // ШАГ 2: НАЛОЖЕНИЕ СТРУКТУРЫ (Labeling)
  // ============================================
  // Приоритет: раскладка v2 (мостики) — счёт 1-8 по сегментам с учётом row1_start (РАЗ/ПЯТЬ)
  const v2Layout = gridMap.v2Layout;
  if (v2Layout && v2Layout.length > 0) {
    for (const beat of skeletonBeats) {
      const T = beat.time;
      const seg = v2Layout.find(
        (s) => T >= s.time_start - 0.05 && T <= s.time_end + 0.05,
      );
      const segment =
        seg ??
        (T < v2Layout[0].time_start
          ? v2Layout[0]
          : v2Layout[v2Layout.length - 1]);
      const timeStart = segment.time_start;
      const row1Start = segment.row1_start;
      const localBeatIndex = Math.round((T - timeStart) / beatInterval);
      beat.number = ((((row1Start - 1 + localBeatIndex) % 8) + 8) % 8) + 1;
    }
    return skeletonBeats;
  }

  // Если нет секций, просто нумеруем по порядку (1-8)
  if (sections.length === 0) {
    let beatNumber = 1;
    for (const beat of skeletonBeats) {
      beat.number = beatNumber;
      beatNumber = (beatNumber % 8) + 1;
    }
    return skeletonBeats;
  }

  // Сортируем секции по времени начала
  const sortedSections = [...sections].sort((a, b) => a.start - b.start);

  // Создаем массив для хранения информации о секциях: индекс ближайшего beat и границы
  interface SectionInfo {
    startBeatIndex: number;
    endBeatIndex: number;
    section: (typeof sortedSections)[0];
  }
  const sectionInfos: SectionInfo[] = [];

  // ШАГ 2.1: Находим ближайший beat для каждой секции и определяем границы
  for (let i = 0; i < sortedSections.length; i++) {
    const section = sortedSections[i];
    const sectionStart = section.start;
    const sectionEnd =
      i < sortedSections.length - 1 ? sortedSections[i + 1].start : duration;

    // Находим ближайший beat к началу секции
    let nearestBeatIndex = -1;
    let minDistance = Infinity;

    for (let j = 0; j < skeletonBeats.length; j++) {
      const distance = Math.abs(skeletonBeats[j].time - sectionStart);
      if (distance < minDistance) {
        minDistance = distance;
        nearestBeatIndex = j;
      }
    }

    if (nearestBeatIndex === -1) continue;

    // Находим последний beat в секции (до начала следующей секции или до конца трека)
    let endBeatIndex = skeletonBeats.length - 1;
    for (let j = nearestBeatIndex; j < skeletonBeats.length; j++) {
      if (skeletonBeats[j].time > sectionEnd + 0.1) {
        endBeatIndex = j - 1;
        break;
      }
    }

    sectionInfos.push({
      startBeatIndex: nearestBeatIndex,
      endBeatIndex: endBeatIndex,
      section: section,
    });
  }

  // ШАГ 2.2: Нумеруем все beats
  // Сначала нумеруем beats до первой секции
  let currentBeatNum = 1;
  let firstSectionStartIndex =
    sectionInfos.length > 0
      ? sectionInfos[0].startBeatIndex
      : skeletonBeats.length;

  for (let i = 0; i < firstSectionStartIndex; i++) {
    skeletonBeats[i].number = currentBeatNum;
    currentBeatNum = (currentBeatNum % 8) + 1;
  }

  // Затем нумеруем beats внутри каждой секции, начиная с "1" на начале секции
  for (const sectionInfo of sectionInfos) {
    const isBridgeSection = sectionInfo.section.type === "bridge";
    // Сбрасываем на "1" на начале секции
    let beatNum = 1;

    for (
      let i = sectionInfo.startBeatIndex;
      i <= sectionInfo.endBeatIndex;
      i++
    ) {
      skeletonBeats[i].number = beatNum;
      if (isBridgeSection) {
        skeletonBeats[i].isBridge = true;
      }
      beatNum = (beatNum % 8) + 1;
    }
  }

  // Наконец, нумеруем beats после последней секции
  if (sectionInfos.length > 0) {
    const lastSectionInfo = sectionInfos[sectionInfos.length - 1];
    const lastBeatNum = skeletonBeats[lastSectionInfo.endBeatIndex].number;
    currentBeatNum = (lastBeatNum % 8) + 1;

    for (
      let i = lastSectionInfo.endBeatIndex + 1;
      i < skeletonBeats.length;
      i++
    ) {
      skeletonBeats[i].number = currentBeatNum;
      currentBeatNum = (currentBeatNum % 8) + 1;
    }
  }

  return skeletonBeats;
}
