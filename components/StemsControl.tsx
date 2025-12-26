'use client'

import { usePlayerStore } from '@/store/playerStore'
import { AudioEngine } from '@/lib/audioEngine'

interface StemsControlProps {
  audioEngine: AudioEngine | null
}

export default function StemsControl({ audioEngine }: StemsControlProps) {
  const { currentTrack, stemsEnabled, stemsVolume, setStemsEnabled, setStemsVolume } = usePlayerStore()

  // Проверяем, обработан ли трек
  const isProcessed = currentTrack?.isProcessed && 
    currentTrack.pathVocals && 
    currentTrack.pathDrums && 
    currentTrack.pathBass && 
    currentTrack.pathOther

  // Если трек не обработан, не показываем панель управления дорожками
  if (!isProcessed) {
    return null
  }

  const stems = [
    { key: 'vocals' as const, label: 'Vocals', color: 'bg-blue-500' },
    { key: 'drums' as const, label: 'Drums', color: 'bg-red-500' },
    { key: 'bass' as const, label: 'Bass', color: 'bg-green-500' },
    { key: 'other' as const, label: 'Other', color: 'bg-yellow-500' },
  ]

  const handleToggle = (key: keyof typeof stemsEnabled) => {
    const newEnabled = { ...stemsEnabled, [key]: !stemsEnabled[key] }
    setStemsEnabled({ [key]: newEnabled[key] })
    audioEngine?.setStemsEnabled({ [key]: newEnabled[key] })
  }

  const handleVolumeChange = (key: keyof typeof stemsVolume, volume: number) => {
    setStemsVolume({ [key]: volume })
    audioEngine?.setStemsVolume({ [key]: volume })
  }

  return (
    <div className="space-y-4 p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Stem Controls</h3>
      
      <div className="space-y-3">
        {stems.map((stem) => (
          <div key={stem.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={stemsEnabled[stem.key]}
                  onChange={() => handleToggle(stem.key)}
                  className="w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer bg-gray-700 border-gray-600"
                />
                <label className="text-sm font-medium text-gray-300 cursor-pointer">
                  {stem.label}
                </label>
              </div>
              <span className="text-sm text-gray-400">
                {stemsVolume[stem.key]}%
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${stem.color}`} />
              <input
                type="range"
                min="0"
                max="100"
                value={stemsVolume[stem.key]}
                onChange={(e) => handleVolumeChange(stem.key, parseInt(e.target.value))}
                disabled={!stemsEnabled[stem.key]}
                className={`flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer ${
                  !stemsEnabled[stem.key] ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                style={{
                  background: `linear-gradient(to right, ${stem.color} 0%, ${stem.color} ${stemsVolume[stem.key]}%, #374151 ${stemsVolume[stem.key]}%, #374151 100%)`
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

