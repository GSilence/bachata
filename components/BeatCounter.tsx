"use client";

import { useState, useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";

interface BeatCounterProps {
  currentBeat: number; // 0-7 (соответствует 1-8)
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  displayMode?: "inline" | "fullscreen";
  onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
}

export default function BeatCounter({
  currentBeat,
  onPlay,
  onPause,
  onStop,
  displayMode: externalDisplayMode,
  onDisplayModeChange,
}: BeatCounterProps) {
  const [internalDisplayMode, setInternalDisplayMode] = useState<
    "inline" | "fullscreen"
  >("inline");
  const [isFullscreenOverlayVisible, setIsFullscreenOverlayVisible] =
    useState(false);
  const { isPlaying, currentTrack } = usePlayerStore();
  const beats = [1, 2, 3, 4, 5, 6, 7, 8];

  // Используем внешний режим, если он передан, иначе внутренний
  const displayMode = externalDisplayMode ?? internalDisplayMode;

  // Показываем оверлей когда начинается воспроизведение в режиме fullscreen
  useEffect(() => {
    if (displayMode === "fullscreen" && isPlaying && currentTrack) {
      setIsFullscreenOverlayVisible(true);
    }
  }, [displayMode, isPlaying, currentTrack]);

  // Получаем текущий активный бит для озвучки
  const activeBeatNumber = beats[currentBeat];

  const handleNumberClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying && onPause) {
      onPause();
    } else if (!isPlaying && onPlay) {
      onPlay();
      setIsFullscreenOverlayVisible(true);
    }
  };

  const handleBackgroundClick = () => {
    // Останавливаем трек и закрываем оверлей при клике на фон
    if (onStop) {
      onStop();
    }
    setIsFullscreenOverlayVisible(false);
  };

  return (
    <>
      {/* Счет в строке или "Запустить" в зависимости от режима */}
      <div
        className="flex justify-between items-center w-full"
        data-component="beat-counter"
      >
        {displayMode === "fullscreen" && !isPlaying && currentTrack ? (
          // Показываем "Запустить" в блоке beat-counter когда режим fullscreen и не играет
          <div
            onClick={(e) => {
              e.stopPropagation();
              if (onPlay) {
                onPlay();
                setIsFullscreenOverlayVisible(true);
              }
            }}
            className="w-full text-center cursor-pointer hover:text-purple-400 transition-colors text-2xl md:text-5xl font-bold text-purple-400"
          >
            Запустить
          </div>
        ) : (
          // Показываем обычный счет
          beats.map((beat, index) => {
            const isActive = index === currentBeat;
            return (
              <div
                key={beat}
                data-beat={beat}
                data-active={isActive}
                className={`
                  flex-1 text-center transition-all duration-200
                  ${
                    isActive
                      ? "scale-[2] font-bold text-purple-400"
                      : "scale-100 text-gray-400"
                  }
                  text-2xl md:text-5xl
                `}
              >
                {beat}
              </div>
            );
          })
        )}
      </div>

      {/* Режим "Во весь экран" - показываем оверлей когда играет */}
      {displayMode === "fullscreen" &&
        currentTrack &&
        isFullscreenOverlayVisible && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300"
            style={{
              background: "rgba(0, 0, 0, 0.8)",
              backdropFilter: "blur(10px)",
            }}
            onClick={handleBackgroundClick}
          >
            {/* Показываем цифру если играет, иконку плей если на паузе */}
            {isPlaying ? (
              <div
                onClick={handleNumberClick}
                className="text-white text-center cursor-pointer text-[20rem] md:text-[clamp(4rem,20vw,15rem)]"
                style={{
                  fontWeight: "bold",
                  textShadow: "0 0 40px rgba(192, 132, 252, 0.8)",
                }}
              >
                {activeBeatNumber}
              </div>
            ) : (
              <div
                onClick={handleNumberClick}
                className="text-white text-center cursor-pointer hover:text-purple-400 transition-colors w-[20rem] h-[20rem] md:w-[clamp(4rem,20vw,15rem)] md:h-[clamp(4rem,20vw,15rem)]"
              >
                <svg
                  className="w-full h-full"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              </div>
            )}
          </div>
        )}
    </>
  );
}
