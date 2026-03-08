"use client";

import { useState, useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";

interface BeatCounterProps {
  currentBeat: number; // 0-7 (соответствует 1-8)
  isBridge?: boolean; // true если текущий бит внутри бриджа (жёлтый цвет)
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  displayMode?: "inline" | "fullscreen";
  onDisplayModeChange?: (mode: "inline" | "fullscreen") => void;
}

export default function BeatCounter({
  currentBeat,
  isBridge,
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
  // ── Zustand selectors — НЕ подписываемся на currentTime (60fps) ──
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const hasCurrentTrack = usePlayerStore((s) => s.currentTrack != null);
  // boolean selector: перерисовка только при переходе 0↔non-zero, не каждый кадр
  const isTimeZero = usePlayerStore((s) => s.currentTime === 0);
  const beats = [1, 2, 3, 4, 5, 6, 7, 8];

  // Сброс по Стоп: при 0:00 и не играет — не показывать счёт (только при паузе оставляем как есть)
  const isStopped = hasCurrentTrack && isTimeZero && !isPlaying;

  // Используем внешний режим, если он передан, иначе внутренний
  const displayMode = externalDisplayMode ?? internalDisplayMode;

  // Показываем оверлей когда начинается воспроизведение в режиме fullscreen
  useEffect(() => {
    if (displayMode === "fullscreen" && isPlaying && hasCurrentTrack) {
      setIsFullscreenOverlayVisible(true);
    }
  }, [displayMode, isPlaying, hasCurrentTrack]);

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
        {isStopped ? (
          // После Стоп — цифры без выделения, чтобы не сбивать
          beats.map((beat) => (
            <div
              key={beat}
              data-beat={beat}
              data-active={false}
              className="flex-1 text-center text-gray-400 scale-100 text-2xl md:text-5xl"
            >
              {beat}
            </div>
          ))
        ) : displayMode === "fullscreen" && !isPlaying && hasCurrentTrack ? (
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
                  flex-1 text-center transition-transform duration-200
                  ${
                    isActive
                      ? isBridge
                        ? "scale-[2] font-bold text-yellow-400"
                        : "scale-[2] font-bold text-purple-400"
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
        hasCurrentTrack &&
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
                className={`text-center cursor-pointer text-[20rem] md:text-[clamp(4rem,20vw,15rem)] ${
                  isBridge ? "text-yellow-400" : "text-white"
                }`}
                style={{
                  fontWeight: "bold",
                  textShadow: isBridge
                    ? "0 0 40px rgba(250, 204, 21, 0.8)"
                    : "0 0 40px rgba(192, 132, 252, 0.8)",
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
