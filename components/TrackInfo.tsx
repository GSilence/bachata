"use client";

import { useState, useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";

interface TrackInfoProps {}

export default function TrackInfo({}: TrackInfoProps) {
  const { currentTrack, setCurrentTrack } = usePlayerStore();
  const [editingBpm, setEditingBpm] = useState(false);
  const [editingOffset, setEditingOffset] = useState(false);
  const [tempBpm, setTempBpm] = useState(currentTrack?.bpm.toString() || "120");
  const [tempOffset, setTempOffset] = useState(
    currentTrack?.offset.toString() || "0"
  );

  // Обновляем временные значения при смене трека
  useEffect(() => {
    if (currentTrack) {
      setTempBpm(currentTrack.bpm.toString());
      setTempOffset(currentTrack.offset.toString());
      // Сбрасываем режимы редактирования при смене трека
      setEditingBpm(false);
      setEditingOffset(false);
    }
  }, [currentTrack]);

  if (!currentTrack) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <p className="text-gray-400 text-center">
          Выберите трек для воспроизведения
        </p>
      </div>
    );
  }

  const handleBpmChange = async (newBpm: number) => {
    if (!currentTrack) return;

    // Обновляем локально
    const updatedTrack = { ...currentTrack, bpm: newBpm };
    setCurrentTrack(updatedTrack);

    // Убраны вызовы audioEngine - упрощенный плеер не анализирует файл
    // TODO: Обновить BPM в БД через API
    console.log("BPM changed to:", newBpm);
  };

  const handleOffsetChange = async (newOffset: number) => {
    if (!currentTrack) return;

    // Обновляем локально
    const updatedTrack = { ...currentTrack, offset: newOffset };
    setCurrentTrack(updatedTrack);

    // Убраны вызовы audioEngine - упрощенный плеер не анализирует файл
    // TODO: Обновить Offset в БД через API
    console.log("Offset changed to:", newOffset);
  };

  const resetBpm = () => {
    if (currentTrack.baseBpm) {
      setTempBpm(currentTrack.baseBpm.toString());
      handleBpmChange(currentTrack.baseBpm);
    }
  };

  const resetOffset = () => {
    if (
      currentTrack.baseOffset !== null &&
      currentTrack.baseOffset !== undefined
    ) {
      setTempOffset(currentTrack.baseOffset.toString());
      handleOffsetChange(currentTrack.baseOffset);
    }
  };

  return (
    <div 
      className="bg-gray-800 rounded-lg p-6 border border-gray-700"
      data-component="track-info"
    >
      {/* Название и исполнитель */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-1">
          {currentTrack.title}
        </h2>
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
                    const bpm = parseInt(tempBpm);
                    if (!isNaN(bpm) && bpm > 0) {
                      handleBpmChange(bpm);
                    }
                    setEditingBpm(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const bpm = parseInt(tempBpm);
                      if (!isNaN(bpm) && bpm > 0) {
                        handleBpmChange(bpm);
                      }
                      setEditingBpm(false);
                    } else if (e.key === "Escape") {
                      setTempBpm(currentTrack.bpm.toString());
                      setEditingBpm(false);
                    }
                  }}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                  autoFocus
                />
                {currentTrack.baseBpm &&
                  currentTrack.baseBpm !== parseInt(tempBpm) && (
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
                <span className="text-white font-medium">
                  {currentTrack.bpm}
                </span>
                <button
                  onClick={() => setEditingBpm(true)}
                  className="text-xs text-purple-400 hover:text-purple-300 ml-2 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
                  title="Редактировать BPM"
                >
                  ✎
                </button>
                {currentTrack.baseBpm &&
                  currentTrack.baseBpm !== currentTrack.bpm && (
                    <button
                      onClick={resetBpm}
                      className="text-xs text-purple-400 hover:text-purple-300 ml-1"
                      title="Сбросить к базовому значению"
                    >
                      ↺
                    </button>
                  )}
              </>
            )}
          </div>
          {currentTrack.baseBpm && (
            <p className="text-xs text-gray-500 mt-1">
              Базовое: {currentTrack.baseBpm}
            </p>
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
                    const offset = parseFloat(tempOffset);
                    if (!isNaN(offset) && offset >= 0) {
                      handleOffsetChange(offset);
                    }
                    setEditingOffset(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const offset = parseFloat(tempOffset);
                      if (!isNaN(offset) && offset >= 0) {
                        handleOffsetChange(offset);
                      }
                      setEditingOffset(false);
                    } else if (e.key === "Escape") {
                      setTempOffset(currentTrack.offset.toString());
                      setEditingOffset(false);
                    }
                  }}
                  className="w-20 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
                  autoFocus
                />
                {currentTrack.baseOffset !== null &&
                  currentTrack.baseOffset !== undefined &&
                  currentTrack.baseOffset !== parseFloat(tempOffset) && (
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
                <span className="text-white font-medium">
                  {currentTrack.offset.toFixed(2)}s
                </span>
                <button
                  onClick={() => setEditingOffset(true)}
                  className="text-xs text-purple-400 hover:text-purple-300 ml-2 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
                  title="Редактировать Offset"
                >
                  ✎
                </button>
                {currentTrack.baseOffset !== null &&
                  currentTrack.baseOffset !== undefined &&
                  currentTrack.baseOffset !== currentTrack.offset && (
                    <button
                      onClick={resetOffset}
                      className="text-xs text-purple-400 hover:text-purple-300 ml-1"
                      title="Сбросить к базовому значению"
                    >
                      ↺
                    </button>
                  )}
              </>
            )}
          </div>
          {currentTrack.baseOffset !== null &&
            currentTrack.baseOffset !== undefined && (
              <p className="text-xs text-gray-500 mt-1">
                Базовое: {currentTrack.baseOffset.toFixed(2)}s
              </p>
            )}
        </div>
      </div>
    </div>
  );
}
