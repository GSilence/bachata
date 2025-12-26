'use client'

import { usePlayerStore } from '@/store/playerStore'
import { useEffect, useRef, useState } from 'react'

import { AudioEngine } from '@/lib/audioEngine'

interface PlayerControlsProps {
  audioEngine: AudioEngine | null
  onPlay: () => void
  onPause: () => void
}

export default function PlayerControls({ audioEngine, onPlay, onPause }: PlayerControlsProps) {
  const {
    isPlaying,
    currentTime,
    duration,
    musicVolume,
    voiceVolume,
    setCurrentTime,
    setMusicVolume,
    setVoiceVolume,
  } = usePlayerStore()

  const [isDragging] = useState(false)
  const progressRef = useRef<HTMLDivElement>(null)

  // Обновляем время воспроизведения
  useEffect(() => {
    if (!audioEngine) return

    const interval = setInterval(() => {
      if (!audioEngine) return
      
      const time = audioEngine.getCurrentTime()
      const dur = audioEngine.getDuration()
      
      // Обновляем время только если не перетаскиваем
      if (!isDragging && time >= 0) {
        setCurrentTime(time)
      }
      
      // Обновляем длительность, если она изменилась
      if (dur > 0 && dur !== duration) {
        usePlayerStore.getState().setDuration(dur)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [isPlaying, audioEngine, isDragging, setCurrentTime, duration])

  // Обновляем длительность при загрузке трека и во время воспроизведения
  useEffect(() => {
    if (!audioEngine) return

    const updateDuration = () => {
      const dur = audioEngine.getDuration()
      if (dur > 0 && dur !== duration) {
        usePlayerStore.getState().setDuration(dur)
      }
    }

    // Обновляем сразу
    updateDuration()

    // И периодически проверяем (на случай, если трек еще загружается)
    const interval = setInterval(updateDuration, 500)

    return () => clearInterval(interval)
  }, [audioEngine, duration])

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !audioEngine) return

    const rect = progressRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const width = rect.width
    const percentage = Math.max(0, Math.min(1, x / width))
    
    // Если длительность еще не загружена, пытаемся получить ее
    let currentDuration = duration
    if (currentDuration === 0) {
      currentDuration = audioEngine.getDuration()
      if (currentDuration > 0) {
        usePlayerStore.getState().setDuration(currentDuration)
      }
    }

    if (currentDuration === 0) return

    const newTime = percentage * currentDuration

    setCurrentTime(newTime)
    audioEngine.seek(newTime)
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="space-y-6">
      {/* Play/Pause Button */}
      <div className="flex justify-center">
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="w-20 h-20 rounded-full bg-purple-600 text-white flex items-center justify-center hover:bg-purple-700 transition-colors shadow-lg"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 4h4v12H6V4zm4 0h4v12h-4V4z" />
            </svg>
          ) : (
            <svg className="w-10 h-10 ml-1" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
          )}
        </button>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div
          ref={progressRef}
          onClick={handleProgressClick}
          className="w-full h-2 bg-gray-700 rounded-full cursor-pointer relative"
        >
          <div
            className="absolute top-0 left-0 h-full bg-purple-600 rounded-full transition-all"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="flex justify-between text-sm text-gray-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Volume Mixer */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Music Volume: {musicVolume}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={musicVolume}
            onChange={(e) => {
              const vol = parseInt(e.target.value)
              setMusicVolume(vol)
              audioEngine?.setMusicVolume(vol)
            }}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Voice Volume: {voiceVolume}%
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={voiceVolume}
            onChange={(e) => {
              const vol = parseInt(e.target.value)
              setVoiceVolume(vol)
              audioEngine?.setVoiceVolume(vol)
            }}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>
    </div>
  )
}

