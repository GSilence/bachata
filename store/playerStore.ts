import { create } from 'zustand'
import type { PlayerState, Track, PlayMode, VoiceFilter, PlaylistFilter } from '@/types'

export const usePlayerStore = create<PlayerState>((set, get) => ({
  // Initial state
  currentTrack: null,
  tracks: [],
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  musicVolume: 100,
  voiceVolume: 120, // На 20% громче музыки по умолчанию (ограничено до 100 в UI)
  
  // Управление дорожками (по умолчанию все включены)
  stemsEnabled: {
    vocals: true,
    drums: true,
    bass: true,
    other: true,
  },
  stemsVolume: {
    vocals: 100,
    drums: 100,
    bass: 100,
    other: 100,
  },
  
  playMode: 'sequential',
  voiceFilter: 'on1and5',
  playlistFilter: 'free',
  searchQuery: '',

  // Actions
  setCurrentTrack: (track) => set({ currentTrack: track }),
  setTracks: (tracks) => set({ tracks }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  setMusicVolume: (volume) => set({ musicVolume: Math.max(0, Math.min(100, volume)) }),
  setVoiceVolume: (volume) => set({ voiceVolume: Math.max(0, Math.min(100, volume)) }),
  setStemsEnabled: (stems) => set((state) => ({ 
    stemsEnabled: { ...state.stemsEnabled, ...stems } 
  })),
  setStemsVolume: (stems) => set((state) => ({ 
    stemsVolume: { 
      ...state.stemsVolume, 
      ...Object.fromEntries(
        Object.entries(stems).map(([key, value]) => [key, Math.max(0, Math.min(100, value))])
      )
    } 
  })),
  setPlayMode: (mode) => set({ playMode: mode }),
  setVoiceFilter: (filter) => set({ voiceFilter: filter }),
  setPlaylistFilter: (filter) => set({ playlistFilter: filter }),
  setSearchQuery: (query) => set({ searchQuery: query }),

  playNext: () => {
    const { currentTrack, tracks, playMode } = get()
    if (!currentTrack || tracks.length === 0) return

    const currentIndex = tracks.findIndex(t => t.id === currentTrack.id)
    
    if (playMode === 'random') {
      const randomIndex = Math.floor(Math.random() * tracks.length)
      set({ currentTrack: tracks[randomIndex] })
    } else if (playMode === 'loop') {
      // Остаемся на том же треке
      return
    } else {
      // sequential
      const nextIndex = (currentIndex + 1) % tracks.length
      set({ currentTrack: tracks[nextIndex] })
    }
  },

  playPrevious: () => {
    const { currentTrack, tracks, playMode } = get()
    if (!currentTrack || tracks.length === 0) return

    const currentIndex = tracks.findIndex(t => t.id === currentTrack.id)
    
    if (playMode === 'random') {
      const randomIndex = Math.floor(Math.random() * tracks.length)
      set({ currentTrack: tracks[randomIndex] })
    } else if (playMode === 'loop') {
      // Остаемся на том же треке
      return
    } else {
      // sequential
      const prevIndex = currentIndex === 0 ? tracks.length - 1 : currentIndex - 1
      set({ currentTrack: tracks[prevIndex] })
    }
  },
}))

