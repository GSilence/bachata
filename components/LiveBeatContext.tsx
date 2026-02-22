"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from "react";
import { audioEngine } from "@/lib/audioEngine";

export interface LiveBeatInfo {
  time: number;
  number: number;
  isBridge: boolean;
}

const LiveBeatStateContext = createContext<LiveBeatInfo | null>(null);
const LiveBeatDispatchContext = createContext<
  React.Dispatch<React.SetStateAction<LiveBeatInfo | null>>
>(() => {});

export function useLiveBeatState() {
  return useContext(LiveBeatStateContext);
}

export function useLiveBeatDispatch() {
  return useContext(LiveBeatDispatchContext);
}

interface LiveBeatProviderProps {
  isPlaying: boolean;
  currentTrack: { offset: number } | null;
  children: React.ReactNode;
}

export function LiveBeatProvider({
  isPlaying,
  currentTrack,
  children,
}: LiveBeatProviderProps) {
  const [liveBeatInfo, setLiveBeatInfo] = useState<LiveBeatInfo | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // При смене трека — показываем бит 1
  useEffect(() => {
    if (currentTrack) {
      setLiveBeatInfo({
        time: currentTrack.offset,
        number: 1,
        isBridge: false,
      });
    }
  }, [currentTrack?.id, currentTrack?.offset]);

  // Тик только для блока счётчика — не трогает TrackInfo и анализ
  useEffect(() => {
    if (isPlaying && currentTrack) {
      intervalRef.current = setInterval(() => {
        const info = audioEngine.getCurrentBeatInfo();
        setLiveBeatInfo(info);
      }, 50);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, currentTrack]);

  return (
    <LiveBeatStateContext.Provider value={liveBeatInfo}>
      <LiveBeatDispatchContext.Provider value={setLiveBeatInfo}>
        {children}
      </LiveBeatDispatchContext.Provider>
    </LiveBeatStateContext.Provider>
  );
}

function formatTime(seconds: number) {
  const min = Math.floor(seconds / 60);
  const sec = (seconds % 60).toFixed(1);
  return `${min}:${sec.padStart(2, "0")}`;
}

interface LiveBeatBlockProps {
  currentTrack: { id?: string | number } | null;
  isReanalyzing: boolean;
}

export function LiveBeatBlock({
  currentTrack,
  isReanalyzing,
}: LiveBeatBlockProps) {
  const liveBeatInfo = useLiveBeatState();
  const setLiveBeatInfo = useLiveBeatDispatch();

  return (
    <div className="mb-2 px-2 py-2 bg-gray-700/50 rounded">
      <div className="flex items-center gap-1 mb-1">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((beat) => {
          const isActive = liveBeatInfo?.number === beat;
          const isBridgeBeat = isActive && liveBeatInfo?.isBridge;
          return (
            <div
              key={beat}
              className={`flex-1 text-center text-sm font-mono font-bold py-1 rounded ${
                isActive
                  ? isBridgeBeat
                    ? "bg-yellow-500/30 text-yellow-400"
                    : "bg-purple-500/30 text-purple-400"
                  : "text-gray-500"
              }`}
            >
              {beat}
            </div>
          );
        })}
      </div>
      {liveBeatInfo && (
        <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
          <div className="flex items-center gap-2">
            <span>{formatTime(liveBeatInfo.time)}</span>
            <span className="text-gray-500">
              ({liveBeatInfo.time.toFixed(3)}s)
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                if (!currentTrack || !audioEngine) return;
                const grid = audioEngine.getBeatGrid();
                if (!grid || grid.length === 0) return;
                let currentIdx = -1;
                for (let i = grid.length - 1; i >= 0; i--) {
                  if (grid[i].time <= liveBeatInfo.time + 0.01) {
                    currentIdx = i;
                    break;
                  }
                }
                const targetIdx = Math.max(0, currentIdx - 1);
                const targetBeat = grid[targetIdx];
                audioEngine.seek(targetBeat.time);
                setLiveBeatInfo({
                  time: targetBeat.time,
                  number: targetBeat.number,
                  isBridge: !!targetBeat.isBridge,
                });
              }}
              disabled={!currentTrack || isReanalyzing}
              className="px-2 py-0.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="На 1 бит назад"
            >
              ◀
            </button>
            <button
              onClick={() => {
                if (!currentTrack || !audioEngine) return;
                const grid = audioEngine.getBeatGrid();
                if (!grid || grid.length === 0) return;
                let currentIdx = -1;
                for (let i = grid.length - 1; i >= 0; i--) {
                  if (grid[i].time <= liveBeatInfo.time + 0.01) {
                    currentIdx = i;
                    break;
                  }
                }
                const targetIdx = Math.min(grid.length - 1, currentIdx + 1);
                const targetBeat = grid[targetIdx];
                audioEngine.seek(targetBeat.time);
                setLiveBeatInfo({
                  time: targetBeat.time,
                  number: targetBeat.number,
                  isBridge: !!targetBeat.isBridge,
                });
              }}
              disabled={!currentTrack || isReanalyzing}
              className="px-2 py-0.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
              title="На 1 бит вперёд"
            >
              ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
