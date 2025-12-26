'use client'

import { usePlayerStore } from '@/store/playerStore'
import type { Track } from '@/types'

interface PlaylistProps {
  onTrackSelect: (track: Track) => void
}

export default function Playlist({ onTrackSelect }: PlaylistProps) {
  const {
    tracks,
    playlistFilter,
    searchQuery,
    setPlaylistFilter,
    setSearchQuery,
  } = usePlayerStore()

  // Фильтрация треков
  const filteredTracks = (Array.isArray(tracks) ? tracks : []).filter((track) => {
    // Фильтр по типу
    if (playlistFilter === 'free' && !track.isFree) {
      return false
    }
    // TODO: 'my' и 'all' фильтры для будущей реализации

    // Поиск по названию
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      const matchesTitle = track.title.toLowerCase().includes(query)
      const matchesArtist = track.artist?.toLowerCase().includes(query) || false
      return matchesTitle || matchesArtist
    }

    return true
  })

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-white">Плейлист</h2>

      {/* Фильтры */}
      <div className="flex gap-2">
        <button
          onClick={() => setPlaylistFilter('free')}
          className={`px-4 py-2 rounded transition-colors ${
            playlistFilter === 'free'
              ? 'bg-purple-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Free
        </button>
        <button
          onClick={() => setPlaylistFilter('my')}
          disabled
          className="px-4 py-2 rounded bg-gray-700 text-gray-500 cursor-not-allowed"
        >
          My (Pro)
        </button>
        <button
          onClick={() => setPlaylistFilter('all')}
          disabled
          className="px-4 py-2 rounded bg-gray-700 text-gray-500 cursor-not-allowed"
        >
          All (Pro)
        </button>
      </div>

      {/* Поиск */}
      <input
        type="text"
        placeholder="Поиск по названию..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white placeholder-gray-400"
      />

      {/* Список треков */}
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filteredTracks.length === 0 ? (
          <p className="text-gray-400 text-center py-4">Треки не найдены</p>
        ) : (
          filteredTracks.map((track) => (
            <button
              key={track.id}
              onClick={() => onTrackSelect(track)}
              className="w-full text-left px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg hover:bg-gray-600 hover:border-purple-600 transition-colors"
            >
              <div className="font-medium text-white">{track.title}</div>
              {track.artist && (
                <div className="text-sm text-gray-400">{track.artist}</div>
              )}
              <div className="text-xs text-gray-500 mt-1">
                BPM: {track.bpm} • {track.isFree ? 'Free' : 'Pro'}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

