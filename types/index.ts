export type PlayMode = "sequential" | "random" | "loop";
export type VoiceFilter = "mute" | "on1" | "on1and5" | "full";
export type VoiceLanguage = "en" | "pt";
export type PlaylistFilter = "free" | "my" | "all";

export interface GridSection {
  type: "verse" | "bridge";
  start: number; // время начала в секундах
  beats: number; // количество битов в секции
}

export interface GridMap {
  bpm: number;
  offset: number;
  grid: GridSection[];
  downbeats?: number[]; // Массив времен downbeats (сильных долей) в секундах
  totalBeats?: number; // Общее количество beats для справки
  duration?: number; // Длительность трека в секундах (из анализа)
  bridges?: number[]; // Массив времён начала бриджей (секунды), задаётся админом вручную
}

export interface Beat {
  time: number; // Timestamp in seconds
  number: number; // The beat number (1-8) to speak
  hasVoice: boolean; // Should we play voice? (Breaks/Bridges might have logic)
  isBridge?: boolean; // true если бит внутри бриджа (4-тактная сбивка)
}

export interface Track {
  id: number;
  title: string;
  artist: string | null;
  filename: string;
  bpm: number;
  offset: number;
  baseBpm: number | null; // базовое значение BPM (определено автоматически или при загрузке)
  baseOffset: number | null; // базовое значение Offset (определено автоматически или при загрузке)
  isFree: boolean;
  createdAt: Date;
  // Поля для Spleeter
  pathOriginal: string | null;
  pathVocals: string | null;
  pathDrums: string | null;
  pathBass: string | null;
  pathOther: string | null;
  isProcessed: boolean;
  gridMap: GridMap | null; // сложная структура с grid (verse/bridge секции) от madmom анализа
  beatGrid: Beat[] | null; // Pre-calculated beat grid for rhythm counting
  analyzerType?: "basic" | "extended" | "correlation" | null; // какой анализатор использовался: basic / extended / correlation
  genreHint?: string | null; // автоопределённый жанр: "bachata", "latin", "pop" и т.д.
}

export interface PlayerState {
  // Текущий трек
  currentTrack: Track | null;
  tracks: Track[];

  // Состояние воспроизведения
  isPlaying: boolean;
  currentTime: number;
  duration: number;

  // Громкость
  musicVolume: number; // 0-100
  voiceVolume: number; // 0-100

  // Управление дорожками (для обработанных треков)
  isStemsMode: boolean; // Используем ли stems или цельный файл
  stemsEnabled: {
    vocals: boolean;
    drums: boolean;
    bass: boolean;
    other: boolean;
  };
  stemsVolume: {
    vocals: number; // 0-100
    drums: number; // 0-100
    bass: number; // 0-100
    other: number; // 0-100
  };

  // Настройки
  playMode: PlayMode;
  voiceFilter: VoiceFilter;
  voiceLanguage: VoiceLanguage;

  // Плейлист
  playlistFilter: PlaylistFilter;
  searchQuery: string;

  // Переоценка расклада (блокирует страницу, не сохраняется)
  isReanalyzing: boolean;

  // AudioEngine reference (не сохраняется в localStorage)
  audioEngine: any | null;

  // Actions
  setReanalyzing: (value: boolean) => void;
  setCurrentTrack: (track: Track | null) => void;
  updateCurrentTrack: (track: Track) => void;
  setTracks: (tracks: Track[]) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setMusicVolume: (volume: number) => void;
  setVoiceVolume: (volume: number) => void;
  setStemsMode: (enabled: boolean) => void;
  setStemsEnabled: (stems: Partial<PlayerState["stemsEnabled"]>) => void;
  setStemsVolume: (stems: Partial<PlayerState["stemsVolume"]>) => void;
  setPlayMode: (mode: PlayMode) => void;
  setVoiceFilter: (filter: VoiceFilter) => void;
  setVoiceLanguage: (language: VoiceLanguage) => void;
  setPlaylistFilter: (filter: PlaylistFilter) => void;
  setSearchQuery: (query: string) => void;
  setAudioEngine: (engine: any | null) => void;

  // AudioEngine methods (синхронизируют Zustand и Howler)
  play: () => void;
  pause: () => void;
  stop: () => void;
  loadTrack: (track: Track) => void;
  seek: (time: number) => void;

  playNext: () => void;
  playPrevious: () => void;
}
