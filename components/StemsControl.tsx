"use client";

import { usePlayerStore } from "@/store/playerStore";

export default function StemsControl() {
  const {
    currentTrack,
    isStemsMode,
    stemsEnabled,
    stemsVolume,
    setStemsMode,
    setStemsEnabled,
    setStemsVolume,
  } = usePlayerStore();

  // Проверяем, обработан ли трек
  const isProcessed =
    currentTrack?.isProcessed &&
    currentTrack.pathVocals &&
    currentTrack.pathDrums &&
    currentTrack.pathBass &&
    currentTrack.pathOther;

  // Если трек не обработан, не показываем панель управления дорожками
  if (!isProcessed) {
    return null;
  }

  const handleStemsModeToggle = () => {
    setStemsMode(!isStemsMode);
  };

  const stems = [
    { key: "vocals" as const, label: "Vocals", color: "bg-blue-500" },
    { key: "drums" as const, label: "Drums", color: "bg-red-500" },
    { key: "bass" as const, label: "Bass", color: "bg-green-500" },
    { key: "other" as const, label: "Other", color: "bg-yellow-500" },
  ];

  const handleToggle = (key: keyof typeof stemsEnabled) => {
    setStemsEnabled({ [key]: !stemsEnabled[key] });
  };

  const handleVolumeChange = (
    key: keyof typeof stemsVolume,
    volume: number
  ) => {
    setStemsVolume({ [key]: volume });
  };

  return (
    <div className="space-y-4 p-4">
      {/* Переключатель Stems режима */}
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-300 cursor-pointer">
            Stems Mode
          </label>
          <span className="text-xs text-gray-500">
            {isStemsMode ? "(отдельные дорожки)" : "(цельный файл)"}
          </span>
        </div>
        <button
          onClick={handleStemsModeToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            isStemsMode ? "bg-purple-600" : "bg-gray-600"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              isStemsMode ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Панель управления stems (показывается только если stems режим включен) */}
      {isStemsMode && (
        <>
          <h3 className="text-lg font-semibold text-white mb-4">
            Stem Controls
          </h3>

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
                    onChange={(e) =>
                      handleVolumeChange(stem.key, parseInt(e.target.value))
                    }
                    disabled={!stemsEnabled[stem.key]}
                    className={`flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer ${
                      !stemsEnabled[stem.key]
                        ? "opacity-50 cursor-not-allowed"
                        : ""
                    }`}
                    style={{
                      background: `linear-gradient(to right, ${
                        stem.color
                      } 0%, ${stem.color} ${stemsVolume[stem.key]}%, #374151 ${
                        stemsVolume[stem.key]
                      }%, #374151 100%)`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
