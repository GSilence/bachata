'use client'

import { usePlayerStore } from '@/store/playerStore'
import type { PlayMode, VoiceFilter } from '@/types'

interface SettingsPanelProps {
  showOnlyVoiceFilter?: boolean
  showOnlyPlayMode?: boolean
}

export default function SettingsPanel({ showOnlyVoiceFilter, showOnlyPlayMode }: SettingsPanelProps = {}) {
  const { playMode, voiceFilter, setPlayMode, setVoiceFilter } = usePlayerStore()

  const playModes: { value: PlayMode; label: string }[] = [
    { value: 'sequential', label: 'Sequential (По порядку)' },
    { value: 'random', label: 'Random (Случайно)' },
    { value: 'loop', label: 'Loop (Один трек)' },
  ]

  const voiceFilters: { value: VoiceFilter; label: string }[] = [
    { value: 'mute', label: 'Mute (Только музыка)' },
    { value: 'on1', label: 'On 1 (Голос говорит "One" на первую долю)' },
    { value: 'on1and5', label: 'On 1 & 5 (Голос говорит "One" и "Five")' },
    { value: 'full', label: 'Full (Счет 1-8)' },
  ]

  return (
    <div className="space-y-6" data-component="settings-panel">
      {!showOnlyVoiceFilter && !showOnlyPlayMode && (
        <h2 className="text-xl font-semibold mb-4 text-white">Настройки</h2>
      )}

      {/* Mode Selection */}
      {(!showOnlyVoiceFilter || showOnlyPlayMode) && (
        <div data-setting="play-mode">
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Mode (Режим воспроизведения)
          </label>
          <div className="space-y-2">
            {playModes.map((mode) => (
              <label 
                key={mode.value} 
                className="flex items-center cursor-pointer hover:text-white"
                data-option={mode.value}
              >
                <input
                  type="radio"
                  name="playMode"
                  value={mode.value}
                  checked={playMode === mode.value}
                  onChange={() => setPlayMode(mode.value)}
                  className="mr-2 w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer"
                />
                <span className="text-sm text-gray-300">{mode.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Voice Filter Selection */}
      {(!showOnlyPlayMode || showOnlyVoiceFilter) && (
        <div data-setting="voice-filter">
          <label className="block text-sm font-medium text-gray-400 mb-2">
            Voice Filter (Режим озвучки)
          </label>
          <div className="space-y-2">
            {voiceFilters.map((filter) => (
              <label 
                key={filter.value} 
                className="flex items-center cursor-pointer hover:text-white"
                data-option={filter.value}
              >
                <input
                  type="radio"
                  name="voiceFilter"
                  value={filter.value}
                  checked={voiceFilter === filter.value}
                  onChange={() => setVoiceFilter(filter.value)}
                  className="mr-2 w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer"
                />
                <span className="text-sm text-gray-300">{filter.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

