"use client";

import { useState } from "react";
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
    setTracks,
  } = usePlayerStore();

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Если нет текущего трека, ничего не показываем
  if (!currentTrack) {
    return (
      <div className="space-y-4 p-4">
        <p className="text-gray-400 text-center">
          Выберите трек для управления stems
        </p>
      </div>
    );
  }

  // Проверяем, обработан ли трек
  // Трек считается обработанным только если все пути к stems файлам существуют
  const isProcessed = Boolean(
    currentTrack.isProcessed &&
      currentTrack.pathVocals &&
      currentTrack.pathDrums &&
      currentTrack.pathBass &&
      currentTrack.pathOther
  );

  // Если трек не обработан, показываем кнопку для запуска обработки
  if (!isProcessed) {
    const handleProcessStems = async () => {
      if (!currentTrack?.id) {
        setError("Track ID not found");
        return;
      }

      setIsProcessing(true);
      setError(null);

      try {
        const response = await fetch("/api/process-stems", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ trackId: currentTrack.id }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to process stems");
        }

        // Обновляем трек в store
        const { tracks } = usePlayerStore.getState();
        const updatedTracks = tracks.map((t) =>
          t.id === currentTrack.id ? data.track : t
        );
        setTracks(updatedTracks);

        // Обновляем currentTrack
        usePlayerStore.getState().setCurrentTrack(data.track);
      } catch (err: any) {
        setError(err.message || "An error occurred");
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <div className="space-y-4 p-4">
        <p className="text-sm text-gray-400">
          Для использования режима Stems необходимо разложить трек на отдельные
          дорожки (vocals, drums, bass, other). Это может занять несколько
          минут.
        </p>
        {error && (
          <div className="p-3 bg-red-900/20 border border-red-700 rounded text-red-200 text-sm">
            {error}
          </div>
        )}
        <button
          onClick={handleProcessStems}
          disabled={isProcessing}
          className="py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <span className="flex items-center justify-center">
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Обработка... (это может занять несколько минут)
            </span>
          ) : (
            "Разложить на стемы"
          )}
        </button>
      </div>
    );
  }

  // Если трек обработан, показываем панель управления stems
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
