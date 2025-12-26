export type PlayMode = 'sequential' | 'random' | 'loop'
export type VoiceFilter = 'mute' | 'on1' | 'on1and5' | 'full'
export type PlaylistFilter = 'free' | 'my' | 'all'

export interface Track {
  id: number
  title: string
  artist: string | null
  filename: string
  bpm: number
  offset: number
  baseBpm: number | null // базовое значение BPM (определено автоматически или при загрузке)
  baseOffset: number | null // базовое значение Offset (определено автоматически или при загрузке)
  isFree: boolean
  createdAt: Date
  // Поля для Spleeter
  pathOriginal: string | null
  pathVocals: string | null
  pathDrums: string | null
  pathBass: string | null
  pathOther: string | null
  isProcessed: boolean
}

export interface PlayerState {
  // Текущий трек
  currentTrack: Track | null
  tracks: Track[]
  
  // Состояние воспроизведения
  isPlaying: boolean
  currentTime: number
  duration: number
  
  // Громкость
  musicVolume: number // 0-100
  voiceVolume: number // 0-100
  
  // Управление дорожками (для обработанных треков)
  stemsEnabled: {
    vocals: boolean
    drums: boolean
    bass: boolean
    other: boolean
  }
  stemsVolume: {
    vocals: number // 0-100
    drums: number // 0-100
    bass: number // 0-100
    other: number // 0-100
  }
  
  // Настройки
  playMode: PlayMode
  voiceFilter: VoiceFilter
  
  // Плейлист
  playlistFilter: PlaylistFilter
  searchQuery: string
  
  // Actions
  setCurrentTrack: (track: Track | null) => void
  setTracks: (tracks: Track[]) => void
  setIsPlaying: (isPlaying: boolean) => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setMusicVolume: (volume: number) => void
  setVoiceVolume: (volume: number) => void
  setStemsEnabled: (stems: Partial<PlayerState['stemsEnabled']>) => void
  setStemsVolume: (stems: Partial<PlayerState['stemsVolume']>) => void
  setPlayMode: (mode: PlayMode) => void
  setVoiceFilter: (filter: VoiceFilter) => void
  setPlaylistFilter: (filter: PlaylistFilter) => void
  setSearchQuery: (query: string) => void
  playNext: () => void
  playPrevious: () => void
}

