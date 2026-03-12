export type PlayMode = "sequential" | "random" | "loop";
export type VoiceFilter = "mute" | "on1" | "on1times3" | "on1and5" | "full";
export type VoiceLanguage = "en" | "pt";
export type VoiceType = "human" | "cymbal" | "clap";
export type TrackStatus = "unlistened" | "moderation" | "approved" | "popsa";
export type PlaylistFilter = "free" | "my" | "all";
/** Основная сортировка списка треков в плейлисте */
export type PlaylistSortBy = "title" | "duration" | "date";

export interface GridSection {
  type: "verse" | "bridge";
  start: number; // время начала в секундах
  beats: number; // количество битов в секции
}

/** Сегмент раскладки v2: от мостика к мостику, row1_start = 1 или 5 (счёт РАЗ/ПЯТЬ) */
export interface V2LayoutSegment {
  from_beat: number;
  to_beat: number;
  time_start: number;
  time_end: number;
  row1_start: 1 | 5;
}

export interface GridMap {
  bpm: number;
  offset: number;
  grid: GridSection[];
  downbeats?: number[]; // Массив времен downbeats (сильных долей) в секундах
  totalBeats?: number; // Общее количество beats для справки
  duration?: number; // Длительность трека в секундах (из анализа)
  bridges?: number[]; // Массив времён начала бриджей (секунды), задаётся админом вручную
  /** Раскладка v2 (мостики): сегменты с row1_start для счёта при воспроизведении (активная) */
  v2Layout?: V2LayoutSegment[];
  /** Раскладка v2 по RMS мостикам (хранится постоянно, применяется кнопкой) */
  v2LayoutRms?: V2LayoutSegment[];
  /** Раскладка v2 по перцептивным мостикам (хранится постоянно, применяется кнопкой) */
  v2LayoutPerc?: V2LayoutSegment[];
  /** Разница в %: на сколько РАЗ больше ПЯТЬ — (РАЗ−ПЯТЬ)/ПЯТЬ×100. 0% = поровну. */
  rowDominancePercent?: number;
  /** true если ряды были свопнуты при v2-анализе (ПЯТЬ оказался сильнее) */
  rowSwapped?: boolean;
  /** Номер ряда (1–8), на который при счёте попадает РАЗ — из verdict анализа. Для свайпа: 1–4 → +4 бита, 5–8 → −4. */
  row_one?: number;
  /** Два сильных ряда (1–8), напр. [2, 6]. Второй = ПЯТЬ. */
  winning_rows?: number[];
  // Оригинальные значения до первого свапа — используются для ресета
  originalOffset?: number;
  v2LayoutOriginal?: V2LayoutSegment[];
  v2LayoutRmsOriginal?: V2LayoutSegment[];
  v2LayoutPercOriginal?: V2LayoutSegment[];
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
  baseBpm: number | null;
  baseOffset: number | null;
  isFree: boolean;
  createdAt: Date;
  // Поля для Demucs
  pathOriginal: string | null;
  pathVocals: string | null;
  pathDrums: string | null;
  pathBass: string | null;
  pathOther: string | null;
  isProcessed: boolean;
  gridMap: GridMap | null;
  beatGrid: Beat[] | null;
  analyzerType?: "basic" | "extended" | "correlation" | "v2" | null;
  genreHint?: string | null;
  // Анализ расклада — отдельные колонки БД для фильтрации/сортировки
  rowDominancePercent: number | null;
  rowSwapped: boolean;
  hasBridges: boolean;
  // Статус и метки
  trackStatus: TrackStatus;
  hasAccents: boolean;
  hasMambo: boolean;
  // Метаданные из тегов аудиофайла
  metaTitle: string | null;
  metaArtist: string | null;
  metaAlbum: string | null;
  metaYear: number | null;
  metaGenre: string | null;
  metaComment: string | null;
  metaTrackNum: number | null;
  // Кластеризация
  duration: number | null;
  fileSize: number | null;
  clusterId: number | null;
  isPrimary: boolean;
  clusterExcluded: boolean;
  // Визуализация формы волны
  waveformData?: string | null;
  // AcoustID / MusicBrainz
  coverArtUrl?: string | null;
  metaLookupDone?: boolean;
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
  voiceType: VoiceType;

  // Плейлист
  /** Активный таб плейлиста: "general" | "favorites" | "bookmarks" */
  activePlaylist: string;
  setActivePlaylist: (playlist: string) => void;
  playlistFilter: PlaylistFilter;
  searchQuery: string;
  /** Показывать треки с мостиками (по умолчанию true) */
  bridgeFilterWith: boolean;
  /** Показывать треки без мостиков (по умолчанию true) */
  bridgeFilterWithout: boolean;
  /** Показывать треки со свапнутыми рядами (по умолчанию true) */
  bridgeFilterSwapped: boolean;
  /** Только для админа: флаг для применения фильтра по статусу в store (playNext/playPrevious) */
  isAdmin: boolean;
  /** Админ: показывать треки «Не прослушана» (по умолчанию true) */
  statusFilterUnlistened: boolean;
  /** Админ: показывать треки «На модерации» (по умолчанию true) */
  statusFilterModeration: boolean;
  /** Админ: показывать треки «Согласована» (по умолчанию true) */
  statusFilterApproved: boolean;
  /** Фильтр «Акценты»: true = только треки с меткой «С акцентами» (AND к остальным фильтрам) */
  accentFilterOn: boolean;
  /** Фильтр «Мамбо»: true = только треки с меткой «С мамбо» (AND к остальным фильтрам) */
  mamboFilterOn: boolean;
  /** Сортировка по % доминирования РАЗ над ПЯТЬ: none = без сортировки, asc/desc = только песни без мостиков; с мостиками внизу */
  squareSortDirection: "none" | "asc" | "desc";
  /** Основная сортировка плейлиста: по названию, длительности, дате загрузки, исполнителю */
  playlistSortBy: PlaylistSortBy;
  /** Направление основной сортировки: asc = по возрастанию, desc = по убыванию */
  sortDirection: "asc" | "desc";
  /** Фильтр по % доминирования: показывать треки с pct < 0 */
  dominanceBucketNeg: boolean;
  /** Фильтр по % доминирования: показывать треки с 0 <= pct < 5 */
  dominanceBucketLow: boolean;
  /** Фильтр по % доминирования: показывать треки с pct >= 5 */
  dominanceBucketHigh: boolean;

  /** Ограничить воспроизведение трека до указанного времени (секунды). null = без ограничения */
  playUntilSeconds: number | null;
  /** Начало цикла (секунды). null = с начала трека */
  loopStartSeconds: number | null;
  /** Пауза между циклами (секунды). null/0 = без паузы */
  loopPauseSeconds: number | null;

  /** Скорость воспроизведения (0.5–1.5, по умолчанию 1) */
  playbackRate: number;

  // Переоценка расклада (блокирует страницу, не сохраняется)
  isReanalyzing: boolean;

  /** ID последнего выбранного трека — сохраняется в localStorage для восстановления после перезагрузки */
  savedTrackId: number | null;

  // AudioEngine reference (не сохраняется в localStorage)
  audioEngine: any | null;

  // Actions
  setReanalyzing: (value: boolean) => void;
  setCurrentTrack: (track: Track | null, autoPlay?: boolean) => void;
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
  setVoiceType: (type: VoiceType) => void;
  setPlaylistFilter: (filter: PlaylistFilter) => void;
  setSearchQuery: (query: string) => void;
  setBridgeFilterWith: (value: boolean) => void;
  setBridgeFilterWithout: (value: boolean) => void;
  setBridgeFilterSwapped: (value: boolean) => void;
  setAdmin: (value: boolean) => void;
  setStatusFilterUnlistened: (value: boolean) => void;
  setStatusFilterModeration: (value: boolean) => void;
  setStatusFilterApproved: (value: boolean) => void;
  setAccentFilterOn: (value: boolean) => void;
  setMamboFilterOn: (value: boolean) => void;
  setSquareSortDirection: (dir: "none" | "asc" | "desc") => void;
  setPlaylistSortBy: (by: PlaylistSortBy) => void;
  setSortDirection: (dir: "asc" | "desc") => void;
  setDominanceBucket: (bucket: "neg" | "low" | "high", value: boolean) => void;
  setPlayUntilSeconds: (seconds: number | null) => void;
  setLoopStartSeconds: (seconds: number | null) => void;
  setLoopPauseSeconds: (seconds: number | null) => void;
  setPlaybackRate: (rate: number) => void;
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
