'use client'

import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import BeatCounter from '@/components/BeatCounter'
import PlayerControls from '@/components/PlayerControls'
import SettingsPanel from '@/components/SettingsPanel'
import StemsControl from '@/components/StemsControl'
import TrackInfo from '@/components/TrackInfo'
import Playlist from '@/components/Playlist'
import type { Track } from '@/types'

export default function PlaybackPage() {
  const {
    currentTrack,
    voiceFilter,
    stemsEnabled,
    stemsVolume,
    setCurrentTrack,
    setTracks,
    setIsPlaying,
    playNext,
  } = usePlayerStore()

  const [currentBeat, setCurrentBeat] = useState(0)
  const [isClient, setIsClient] = useState(false)
  const audioEngineRef = useRef<any>(null)

  // Проверяем, что мы на клиенте
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Инициализация аудио-движка (только на клиенте)
  useEffect(() => {
    if (!isClient || typeof window === 'undefined') return

    import('@/lib/audioEngine').then((module) => {
      try {
        audioEngineRef.current = new module.AudioEngine()
        audioEngineRef.current.setOnBeatChange((beat: number) => {
          setCurrentBeat(beat)
        })
        audioEngineRef.current.setOnTrackEnd(() => {
          setIsPlaying(false)
          playNext()
        })
      } catch (error) {
        console.error('Failed to initialize AudioEngine:', error)
      }
    }).catch((error) => {
      console.error('Failed to load AudioEngine:', error)
    })

    return () => {
      if (audioEngineRef.current) {
        try {
          audioEngineRef.current?.destroy()
        } catch (error) {
          console.error('Error destroying AudioEngine:', error)
        }
      }
    }
  }, [isClient, setIsPlaying, playNext])

  // Загрузка треков при монтировании
  useEffect(() => {
    if (!isClient) return

    let cancelled = false

    fetch('/api/tracks')
      .then((res) => {
        if (!res.ok) {
          if (res.status === 500) {
            console.warn('Server returned 500, but continuing...')
            return res.json().catch(() => [])
          }
          throw new Error(`HTTP error! status: ${res.status}`)
        }
        return res.json()
      })
      .then((data) => {
        if (cancelled) return

        if (Array.isArray(data)) {
          setTracks(data)
          if (data.length > 0 && !currentTrack) {
            setCurrentTrack(data[0])
          }
        } else {
          console.warn('API returned non-array data:', data)
          setTracks([])
        }
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Error loading tracks:', error)
        setTracks([])
      })

    return () => {
      cancelled = true
    }
  }, [isClient, setTracks, setCurrentTrack, currentTrack])

  // Загрузка трека в аудио-движок
  useEffect(() => {
    if (currentTrack && audioEngineRef.current) {
      audioEngineRef.current.loadTrack(currentTrack)
      audioEngineRef.current.setVoiceFilter(voiceFilter)
      if (currentTrack.isProcessed) {
        audioEngineRef.current.setStemsEnabled(stemsEnabled)
        audioEngineRef.current.setStemsVolume(stemsVolume)
      }
    }
  }, [currentTrack, stemsEnabled, stemsVolume, voiceFilter])

  // Обновление voice filter
  useEffect(() => {
    if (audioEngineRef.current) {
      audioEngineRef.current.setVoiceFilter(voiceFilter)
    }
  }, [voiceFilter])

  // Синхронизация состояния дорожек
  useEffect(() => {
    if (audioEngineRef.current && currentTrack?.isProcessed) {
      audioEngineRef.current.setStemsEnabled(stemsEnabled)
      audioEngineRef.current.setStemsVolume(stemsVolume)
    }
  }, [stemsEnabled, stemsVolume, currentTrack])

  const handlePlay = () => {
    console.log('Play clicked', { audioEngine: !!audioEngineRef.current, currentTrack })
    if (audioEngineRef.current && currentTrack) {
      console.log('Calling audioEngine.play()')
      audioEngineRef.current.play()
      setIsPlaying(true)
    } else {
      console.warn('Cannot play: audioEngine or currentTrack missing')
    }
  }

  const handlePause = () => {
    if (audioEngineRef.current) {
      audioEngineRef.current.pause()
      setIsPlaying(false)
    }
  }

  const handleTrackSelect = (track: Track) => {
    setCurrentTrack(track)
    setIsPlaying(false)
    if (audioEngineRef.current) {
      audioEngineRef.current.stop()
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-8">Воспроизведение</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Основная секция - слева */}
          <div className="lg:col-span-2 space-y-6">
            {/* Информация о треке */}
            <TrackInfo audioEngine={audioEngineRef.current} />

            {/* Визуализация счета */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <BeatCounter currentBeat={currentBeat} />
            </div>

            {/* Управление воспроизведением */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              {isClient ? (
                <PlayerControls
                  audioEngine={audioEngineRef.current}
                  onPlay={handlePlay}
                  onPause={handlePause}
                />
              ) : (
                <div className="text-center py-8 text-gray-400">Загрузка...</div>
              )}
            </div>

            {/* Режим озвучки (под Voice Volume) */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <SettingsPanel showOnlyVoiceFilter />
            </div>

            {/* Управление дорожками (только для обработанных треков) */}
            {isClient && currentTrack?.isProcessed && (
              <div className="bg-gray-800 rounded-lg border border-gray-700">
                <StemsControl audioEngine={audioEngineRef.current} />
              </div>
            )}
          </div>

          {/* Боковая панель - справа */}
          <div className="space-y-6">
            {/* Плейлист и настройки воспроизведения */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <SettingsPanel showOnlyPlayMode />
            </div>

            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
              <Playlist onTrackSelect={handleTrackSelect} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

