export interface BeatData {
  id: number;
  time: number;
  row: number;
  is_start: boolean;
  madmom_score: number;
  energy: number;
  harmonic: number;
  local_bpm?: number;
  intensity?: number;
  spectral_centroid?: number;
  spectral_flatness?: number;
  onset_strength?: number;
  zcr?: number;
  chroma_note?: string;
  chroma_strength?: number;
  chroma_index?: number;
}

export interface LibrosaSummary {
  librosa_tempo: number;
  dominant_key: string;
  spectral_centroid_mean: number;
  spectral_centroid_std: number;
  spectral_flatness_mean: number;
  onset_strength_mean: number;
  zcr_mean: number;
  bpm_min?: number;
  bpm_max?: number;
  bpm_std?: number;
}

export interface ReportData {
  beats: BeatData[];
  librosa_summary?: LibrosaSummary;
  verdict: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export const CHART_COLORS = {
  energy: '#a78bfa',       // purple-400
  harmonic: '#34d399',     // green-400
  onset: '#f59e0b',        // amber-500
  centroid: '#60a5fa',     // blue-400
  chroma: '#f472b6',       // pink-400
  grid: '#374151',         // gray-700
  text: '#9ca3af',         // gray-400
};

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1f2937',
    border: '1px solid #374151',
    color: '#e5e7eb',
    fontSize: 12,
    borderRadius: 6,
  },
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
