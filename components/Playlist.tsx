'use client'

import { useEffect, useRef } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import type { Track } from '@/types'

interface PlaylistProps {
  onTrackSelect: (track: Track) => void
}

export default function Playlist({ onTrackSelect }: PlaylistProps) {
  const {
    tracks,
    currentTrack,
    playlistFilter,
    searchQuery,
    setPlaylistFilter,
    setSearchQuery,
  } = usePlayerStore()
  
  const activeTrackRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

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

  // Автоматическая прокрутка к активному треку
  useEffect(() => {
    if (activeTrackRef.current && containerRef.current) {
      const container = containerRef.current
      const activeElement = activeTrackRef.current
      
      // Вычисляем позицию активного элемента относительно контейнера
      const containerTop = container.scrollTop
      const containerBottom = containerTop + container.clientHeight
      const elementTop = activeElement.offsetTop
      const elementBottom = elementTop + activeElement.offsetHeight
      
      // Прокручиваем только если элемент не виден
      if (elementTop < containerTop) {
        // Элемент выше видимой области
        container.scrollTo({
          top: elementTop - 10, // Небольшой отступ сверху
          behavior: 'smooth'
        })
      } else if (elementBottom > containerBottom) {
        // Элемент ниже видимой области
        container.scrollTo({
          top: elementBottom - container.clientHeight + 10, // Небольшой отступ снизу
          behavior: 'smooth'
        })
      }
    }
  }, [currentTrack, filteredTracks])

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
      <div 
        ref={containerRef}
        className="space-y-2 max-h-96 overflow-y-auto"
      >
        {tracks.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-2">Плейлист пуст</p>
            <p className="text-sm text-gray-500">Загрузите треки в разделе "Медиатека"</p>
          </div>
        ) : filteredTracks.length === 0 ? (
          <p className="text-gray-400 text-center py-4">Треки не найдены</p>
        ) : (
          filteredTracks.map((track) => {
            const isActive = currentTrack?.id === track.id
            return (
              <button
                key={track.id}
                ref={isActive ? activeTrackRef : null}
                onClick={() => onTrackSelect(track)}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-purple-600 border-2 border-purple-400 hover:bg-purple-700'
                    : 'bg-gray-700 border border-gray-600 hover:bg-gray-600 hover:border-purple-600'
                }`}
              >
                <div className={`font-medium ${isActive ? 'text-white' : 'text-white'}`}>
                  {track.title}
                </div>
                {track.artist && (
                  <div className={`text-sm ${isActive ? 'text-purple-100' : 'text-gray-400'}`}>
                    {track.artist}
                  </div>
                )}
                <div className={`text-xs mt-1 ${isActive ? 'text-purple-200' : 'text-gray-500'}`}>
                  BPM: {track.bpm} • {track.isFree ? 'Free' : 'Pro'}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

