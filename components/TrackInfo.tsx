'use client'

import { useState } from 'react'
import { usePlayerStore } from '@/store/playerStore'
import { AudioEngine } from '@/lib/audioEngine'

interface TrackInfoProps {
  audioEngine: AudioEngine | null
}

export default function TrackInfo({ audioEngine }: TrackInfoProps) {
  const { currentTrack } = usePlayerStore()
  const [editingBpm, setEditingBpm] = useState(false)
  const [editingOffset, setEditingOffset] = useState(false)
  const [tempBpm, setTempBpm] = useState(currentTrack?.bpm.toString() || '120')
  const [tempOffset, setTempOffset] = useState(currentTrack?.offset.toString() || '0')

  if (!currentTrack) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <p className="text-gray-400 text-center">Выберите трек для воспроизведения</p>
      </div>
    )
  }

  const handleBpmChange = async (newBpm: number) => {
    // TODO: Обновить BPM в БД через API
    // Пока просто обновляем локально
    console.log('BPM changed to:', newBpm)
  }

  const handleOffsetChange = async (newOffset: number) => {
    // TODO: Обновить Offset в БД через API
    // Пока просто обновляем локально
    console.log('Offset changed to:', newOffset)
  }

  const resetBpm = () => {
    if (currentTrack.baseBpm) {
      setTempBpm(currentTrack.baseBpm.toString())
      handleBpmChange(currentTrack.baseBpm)
    }
  }

  const resetOffset = () => {
    if (currentTrack.baseOffset !== null && currentTrack.baseOffset !== undefined) {
      setTempOffset(currentTrack.baseOffset.toString())
      handleOffsetChange(currentTrack.baseOffset)
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      {/* Название и исполнитель */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">{currentTrack.title}</h2>
        {currentTrack.artist && (
          <p className="text-gray-400">{currentTrack.artist}</p>
        )}
      </div>

      {/* Параметры */}
      <div className="grid grid-cols-2 gap-4">
        {/* BPM */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            BPM
          </label>
          <div className="flex items-center gap-2">
            {editingBpm ? (
              <>
                <input
                  type="number"
                  value={tempBpm}
                  onChange={(e) => setTempBpm(e.target.value)}
                  onBlur={() => {
                    const bpm = parseInt(tempBpm)
                    if (!isNaN(bpm) && bpm > 0) {
                      handleBpmChange(bpm)
                    }
                    setEditingBpm(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const bpm = parseInt(tempBpm)
                      if (!isNaN(bpm) && bpm > 0) {
                        handleBpmChange(bpm)
                      }
                      setEditingBpm(false)
                    }
                  }}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                  autoFocus
                />
                {currentTrack.baseBpm && currentTrack.baseBpm !== parseInt(tempBpm) && (
                  <button
                    onClick={resetBpm}
                    className="text-xs text-purple-400 hover:text-purple-300"
                    title="Сбросить к базовому значению"
                  >
                    ↺
                  </button>
                )}
              </>
            ) : (
              <>
                <span
                  className="text-white font-medium cursor-pointer hover:text-purple-400"
                  onClick={() => setEditingBpm(true)}
                >
                  {currentTrack.bpm}
                </span>
                {currentTrack.baseBpm && currentTrack.baseBpm !== currentTrack.bpm && (
                  <button
                    onClick={resetBpm}
                    className="text-xs text-purple-400 hover:text-purple-300 ml-2"
                    title="Сбросить к базовому значению"
                  >
                    ↺
                  </button>
                )}
              </>
            )}
          </div>
          {currentTrack.baseBpm && (
            <p className="text-xs text-gray-500 mt-1">Базовое: {currentTrack.baseBpm}</p>
          )}
        </div>

        {/* Offset */}
        <div>
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Offset
          </label>
          <div className="flex items-center gap-2">
            {editingOffset ? (
              <>
                <input
                  type="number"
                  step="0.1"
                  value={tempOffset}
                  onChange={(e) => setTempOffset(e.target.value)}
                  onBlur={() => {
                    const offset = parseFloat(tempOffset)
                    if (!isNaN(offset) && offset >= 0) {
                      handleOffsetChange(offset)
                    }
                    setEditingOffset(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const offset = parseFloat(tempOffset)
                      if (!isNaN(offset) && offset >= 0) {
                        handleOffsetChange(offset)
                      }
                      setEditingOffset(false)
                    }
                  }}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                  autoFocus
                />
                {currentTrack.baseOffset !== null && currentTrack.baseOffset !== undefined && currentTrack.baseOffset !== parseFloat(tempOffset) && (
                  <button
                    onClick={resetOffset}
                    className="text-xs text-purple-400 hover:text-purple-300"
                    title="Сбросить к базовому значению"
                  >
                    ↺
                  </button>
                )}
              </>
            ) : (
              <>
                <span
                  className="text-white font-medium cursor-pointer hover:text-purple-400"
                  onClick={() => setEditingOffset(true)}
                >
                  {currentTrack.offset.toFixed(2)}s
                </span>
                {currentTrack.baseOffset !== null && currentTrack.baseOffset !== undefined && currentTrack.baseOffset !== currentTrack.offset && (
                  <button
                    onClick={resetOffset}
                    className="text-xs text-purple-400 hover:text-purple-300 ml-2"
                    title="Сбросить к базовому значению"
                  >
                    ↺
                  </button>
                )}
              </>
            )}
          </div>
          {currentTrack.baseOffset !== null && currentTrack.baseOffset !== undefined && (
            <p className="text-xs text-gray-500 mt-1">Базовое: {currentTrack.baseOffset.toFixed(2)}s</p>
          )}
        </div>
      </div>
    </div>
  )
}

