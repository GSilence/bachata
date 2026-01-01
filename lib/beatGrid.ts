import type { Beat } from "@/types";

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
      hasVoice: true // All beats have voice by default (can be filtered later)
    });
    
    // Move to next beat
    time += beatInterval;
    
    // Cycle through 1-8
    beatNumber = (beatNumber % 8) + 1;
  }
  
  return beatGrid;
}

