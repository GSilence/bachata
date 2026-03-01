"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { usePlayerStore } from "@/store/playerStore";
import { audioEngine } from "@/lib/audioEngine";
import type { GridMap } from "@/types";
import { LiveBeatProvider, LiveBeatBlock, BridgeHereButton } from "./LiveBeatContext";

const V2AnalysisDisplay = React.memo(
  dynamic(() => import("./charts/V2AnalysisDisplay"), { ssr: false }),
);

export interface TrackInfoAdminPanelProps {
  currentTrack: NonNullable<ReturnType<typeof usePlayerStore.getState>["currentTrack"]>;
  isPlaying: boolean;
  isReanalyzing: boolean;
  onTracksRefetch: () => void;
}

export default function TrackInfoAdminPanel({
  currentTrack,
  isPlaying,
  isReanalyzing,
  onTracksRefetch,
}: TrackInfoAdminPanelProps) {
  const { updateCurrentTrack, setTracks } = usePlayerStore();
  const [v2Result, setV2Result] = useState<any>(null);
  const [isAnalyzingV2, setIsAnalyzingV2] = useState(false);
  const [v2Stage, setV2Stage] = useState("");
  const [bridges, setBridges] = useState<number[]>(
    () => (currentTrack.gridMap as GridMap | null)?.bridges ?? [],
  );
  const [isSavingBridge, setIsSavingBridge] = useState(false);

  React.useEffect(() => {
    const gridMap = currentTrack.gridMap as GridMap | null;
    setBridges(gridMap?.bridges ?? []);
  }, [currentTrack]);

  // Загрузка сохранённого v2 при смене трека
  React.useEffect(() => {
    fetch(`/api/tracks/${currentTrack.id}/analyze-v2?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (data.found) setV2Result(data);
        if (data.found && typeof data.rowDominancePercent === "number") {
          const latestTrack = usePlayerStore.getState().currentTrack;
          if (!latestTrack || latestTrack.id !== currentTrack.id) return;
          const mergedGridMap: GridMap = {
            ...(latestTrack.gridMap || {}),
            rowDominancePercent: data.rowDominancePercent,
          } as GridMap;
          const updatedTrack = {
            ...latestTrack,
            gridMap: mergedGridMap,
            rowDominancePercent: data.rowDominancePercent,
          };
          updateCurrentTrack(updatedTrack);
          const list = usePlayerStore.getState().tracks;
          setTracks(list.map((t) => (t.id === latestTrack.id ? updatedTrack : t)));
        }
      })
      .catch(() => {});
  }, [currentTrack.id, updateCurrentTrack, setTracks]);

  const analysisCompleted =
    currentTrack.analyzerType === "v2" ||
    currentTrack.analyzerType === "basic" ||
    currentTrack.analyzerType === "extended";
  const hasBridgesForSwap =
    bridges.length > 0 ||
    ((currentTrack?.gridMap as GridMap | undefined)?.v2Layout?.length ?? 0) > 1;

  const runV2Analysis = async () => {
    if (!currentTrack || isAnalyzingV2) return;
    setIsAnalyzingV2(true);
    setV2Result(null);
    setV2Stage("");
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/analyze-v2`, { method: "POST" });
      let data: any = null;
      if (res.headers.get("Content-Type")?.includes("text/event-stream") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let evt: any;
            try {
              evt = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (evt.type === "log") setV2Stage(evt.message);
            else if (evt.type === "result") data = evt.data;
            else if (evt.type === "error") throw new Error(evt.message);
          }
          if (data) break outer;
        }
      } else {
        data = await res.json();
      }
      if (!data) throw new Error("No result received from analysis");
      setV2Result(data);
      const freshTrack = usePlayerStore.getState().currentTrack;
      if (
        freshTrack &&
        data.success &&
        Array.isArray(data.layout) &&
        data.layout.length > 0
      ) {
        const existing = (freshTrack.gridMap as Record<string, unknown>) || {};
        const base = typeof existing === "object" ? { ...existing } : {};
        const squareAnalysis = data.square_analysis as { row_dominance_pct?: number } | undefined;
        const rowDominancePercent =
          typeof squareAnalysis?.row_dominance_pct === "number"
            ? squareAnalysis.row_dominance_pct
            : undefined;
        const v2LayoutRms = Array.isArray(data.layout) ? data.layout : [];
        const v2LayoutPerc = Array.isArray(data.layout_perc) ? data.layout_perc : [];
        const activeLayout = v2LayoutPerc.length > 0 ? v2LayoutPerc : v2LayoutRms;
        const percBridgeTimes = activeLayout
          .slice(1)
          .map((s: { time_start?: number }) => s.time_start ?? 0);
        const mergedGridMap: GridMap = {
          bpm: (data.bpm ?? freshTrack.bpm) as number,
          offset: (data.song_start_time ?? freshTrack.baseOffset ?? freshTrack.offset ?? base.offset ?? 0) as number,
          grid: (base.grid as GridMap["grid"]) ?? [],
          bridges: percBridgeTimes,
          duration: (data.duration ?? base.duration) as number | undefined,
          v2Layout: activeLayout as GridMap["v2Layout"],
          v2LayoutRms: v2LayoutRms as GridMap["v2LayoutRms"],
          v2LayoutPerc: v2LayoutPerc as GridMap["v2LayoutPerc"],
          ...(rowDominancePercent != null && { rowDominancePercent }),
        };
        const updatedTrack = {
          ...freshTrack,
          offset: (data.song_start_time ?? freshTrack.baseOffset ?? freshTrack.offset) as number,
          baseOffset: (data.song_start_time ?? freshTrack.baseOffset ?? freshTrack.offset) as number,
          gridMap: mergedGridMap,
          ...(rowDominancePercent != null && { rowDominancePercent }),
        };
        updateCurrentTrack(updatedTrack);
        audioEngine.reloadBeatGrid(updatedTrack);
        const freshTracks = usePlayerStore.getState().tracks;
        setTracks(freshTracks.map((t) => (t.id === freshTrack.id ? updatedTrack : t)));
      }
    } catch (e) {
      console.error("V2 analysis error:", e);
      setV2Result({ error: String(e) });
    } finally {
      setIsAnalyzingV2(false);
      setV2Stage("");
      onTracksRefetch();
    }
  };

  const handleSwapRows = async () => {
    if (!currentTrack || isSavingBridge) return;
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/swap-rows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка свапа рядов");
      if (data.track) {
        updateCurrentTrack(data.track);
        audioEngine.reloadBeatGrid(data.track);
        const freshTracks = usePlayerStore.getState().tracks;
        setTracks(freshTracks.map((t) => (t.id === data.track.id ? data.track : t)));
        onTracksRefetch();
      }
    } catch (e) {
      console.error("Swap rows failed:", e);
      alert(`Ошибка свапа: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const handleSetFlag = async (flag: "hasAccents" | "hasMambo", value: boolean) => {
    if (!currentTrack || isSavingBridge) return;
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [flag]: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка обновления");
      if (data.track) {
        updateCurrentTrack(data.track);
        const freshTracks = usePlayerStore.getState().tracks;
        setTracks(freshTracks.map((t) => (t.id === data.track.id ? data.track : t)));
        onTracksRefetch();
      }
    } catch (e) {
      console.error("Update flag failed:", e);
      alert(`Ошибка: ${e instanceof Error ? e.message : "Unknown error"}`);
    }
  };

  const saveBridges = async (newBridges: number[]) => {
    if (!currentTrack) return;
    setIsSavingBridge(true);
    try {
      const res = await fetch("/api/rhythm/update-bridges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: currentTrack.id, bridges: newBridges }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения бриджа");
      if (data.track) {
        updateCurrentTrack(data.track);
        audioEngine.reloadBeatGrid(data.track);
      }
      setBridges(newBridges);
    } catch (e) {
      console.error("Save bridges failed:", e);
      alert(`Ошибка: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSavingBridge(false);
    }
  };

  const applyLayout = async (type: "rms" | "perc") => {
    if (!currentTrack) return;
    setIsSavingBridge(true);
    try {
      const res = await fetch("/api/rhythm/apply-layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track_id: currentTrack.id, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка применения сетки");
      if (data.track) {
        updateCurrentTrack(data.track);
        audioEngine.reloadBeatGrid(data.track);
        setBridges((data.track.gridMap?.bridges as number[]) ?? []);
      }
    } catch (e) {
      console.error("Apply layout failed:", e);
      alert(`Ошибка: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSavingBridge(false);
    }
  };

  const handleAddBridgeHere = (bridgeTime: number) => {
    if (!currentTrack || isSavingBridge) return;
    const beatInterval = 60 / currentTrack.bpm;
    if (bridges.some((b) => Math.abs(b - bridgeTime) < beatInterval / 2)) {
      alert("Бридж уже существует рядом с этой позицией");
      return;
    }
    const newBridges = [...bridges, bridgeTime].sort((a, b) => a - b);
    saveBridges(newBridges);
  };

  const handleRemoveBridge = (bridgeTime: number) => {
    saveBridges(bridges.filter((b) => b !== bridgeTime));
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = (seconds % 60).toFixed(1);
    return `${min}:${sec.padStart(4, "0")}`;
  };

  const startBeatId =
    v2Result?.row_analysis_verdict?.start_beat_id ??
    (currentTrack.gridMap as { song_start_beat?: number } | undefined)?.song_start_beat;

  const gm = currentTrack.gridMap as GridMap | undefined;
  const rowOne = gm?.row_one;
  const rowSwapped = currentTrack.rowSwapped ?? false;
  const displayedBeatId =
    rowSwapped && rowOne != null && rowOne >= 1 && rowOne <= 8
      ? (rowOne <= 4 ? rowOne + 4 : rowOne - 4)
      : startBeatId;

  return (
    <div className="mt-4 sm:mt-6 space-y-4 border-t border-gray-700 pt-4">
      {/* Предполагаемый стиль */}
      {currentTrack.genreHint && (
        <p className="text-sm text-gray-400">
          Предполагаемый стиль: <span className="text-gray-300">{currentTrack.genreHint}</span>
        </p>
      )}

      {/* Блок анализа v2: иконка справа вверху */}
      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-sm font-medium text-gray-400">Анализ</span>
          <button
            type="button"
            onClick={runV2Analysis}
            disabled={isAnalyzingV2}
            title="Запустить анализ v2 (ряды + мостики)"
            className="p-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Анализ v2"
          >
            {isAnalyzingV2 ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            )}
          </button>
        </div>
        {isAnalyzingV2 && v2Stage && (
          <p className="text-xs text-indigo-300 truncate mb-2" title={v2Stage}>{v2Stage}</p>
        )}

        {/* Одна строка: BPM, Мостики, Offset (бит) — только чтение, каждый в своей обводке */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 border border-[rgb(55_65_81/0.6)] bg-[rgb(55_65_81/0.6)]">
            <span className="text-sm font-medium text-gray-400">BPM:</span>
            <span className="text-white font-medium">{currentTrack.bpm}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 border border-[rgb(55_65_81/0.6)] bg-[rgb(55_65_81/0.6)]">
            <span className="text-sm font-medium text-gray-400">Мостики:</span>
            <span className="text-white font-medium">{bridges.length}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded px-2 py-1 border border-[rgb(55_65_81/0.6)] bg-[rgb(55_65_81/0.6)]">
            <span className="text-sm font-medium text-gray-400">Offset:</span>
            <span className="text-white font-medium">
              {(currentTrack.baseOffset ?? currentTrack.offset).toFixed(3)}s
              {displayedBeatId != null ? ` (бит #${displayedBeatId})` : ""}
            </span>
          </span>
        </div>

        {v2Result && !v2Result.error && (
          <div className="mb-4">
            <details open>
              <summary className="text-lg font-semibold text-gray-300 cursor-pointer hover:text-white select-none">
                Результаты анализа
              </summary>
              <div className="mt-2">
                <V2AnalysisDisplay
                  data={v2Result}
                  trackId={currentTrack.id}
                  trackTitle={currentTrack.title}
                  trackRowSwapped={currentTrack.rowSwapped ?? false}
                />
              </div>
            </details>
          </div>
        )}
        {v2Result?.error && <p className="text-red-400 text-xs mb-4">{v2Result.error}</p>}
      </div>

      {/* Редактирование счёта: Свайп + бриджи в строчку в прямоугольниках */}
      {analysisCompleted && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Редактирование счёта</h3>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button
              type="button"
              onClick={handleSwapRows}
              disabled={isSavingBridge || isReanalyzing || isAnalyzingV2 || hasBridgesForSwap}
              title={
                hasBridgesForSwap
                  ? "Удалите все бриджи, чтобы менять ряды"
                  : currentTrack.rowSwapped
                    ? "Вернуть ряды"
                    : "Поменять ряды РАЗ и ПЯТЬ"
              }
              className={`text-xs px-3 py-1.5 rounded transition-colors inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                hasBridgesForSwap
                  ? "bg-gray-700 text-gray-500"
                  : currentTrack.rowSwapped
                    ? "bg-orange-600 hover:bg-orange-500 text-white"
                    : "bg-gray-600 hover:bg-gray-500 text-gray-200"
              }`}
            >
              {currentTrack.rowSwapped ? "⇄ Свапнуто" : "⇄ Свайп"}
            </button>
            <button
              type="button"
              onClick={() => handleSetFlag("hasAccents", !currentTrack.hasAccents)}
              disabled={isSavingBridge || isReanalyzing}
              title={currentTrack.hasAccents ? "Убрать метку «С акцентами»" : "Пометить: с акцентами"}
              className={`text-xs px-3 py-1.5 rounded transition-colors inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                currentTrack.hasAccents
                  ? "bg-amber-600 hover:bg-amber-500 text-white"
                  : "bg-gray-600 hover:bg-gray-500 text-gray-200"
              }`}
            >
              С акцентами
            </button>
            <button
              type="button"
              onClick={() => handleSetFlag("hasMambo", !currentTrack.hasMambo)}
              disabled={isSavingBridge || isReanalyzing}
              title={currentTrack.hasMambo ? "Убрать метку «С мамбо»" : "Пометить: с мамбо"}
              className={`text-xs px-3 py-1.5 rounded transition-colors inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                currentTrack.hasMambo
                  ? "bg-rose-600 hover:bg-rose-500 text-white"
                  : "bg-gray-600 hover:bg-gray-500 text-gray-200"
              }`}
            >
              С мамбо
            </button>
          </div>

          <LiveBeatProvider isPlaying={isPlaying} currentTrack={currentTrack}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <BridgeHereButton
                disabled={isSavingBridge || isReanalyzing}
                isSaving={isSavingBridge}
                onAddBridge={handleAddBridgeHere}
              />
              {v2Result && !v2Result.error && (
                <>
                  {v2Result.perc_confirmed_bridges?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => applyLayout("perc")}
                      disabled={isSavingBridge || isReanalyzing}
                      title="Применить перцептивную сетку из v2"
                      className="text-xs px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-50"
                    >
                      {isSavingBridge ? "Сохранение..." : `← Перц. (${v2Result.perc_confirmed_bridges.length})`}
                    </button>
                  )}
                  {v2Result.bridges?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => applyLayout("rms")}
                      disabled={isSavingBridge || isReanalyzing}
                      title="Применить RMS сетку из v2"
                      className="text-xs px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-white disabled:opacity-50"
                    >
                      {isSavingBridge ? "Сохранение..." : `← RMS (${v2Result.bridges.length})`}
                    </button>
                  )}
                </>
              )}
            </div>

            <LiveBeatBlock currentTrack={currentTrack} isReanalyzing={isReanalyzing} />

            {bridges.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {bridges.map((b, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-700/60 text-gray-300 text-xs"
                  >
                    <span className="font-mono text-yellow-400">{formatTime(b)}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveBridge(b)}
                      disabled={isSavingBridge}
                      className="text-red-400 hover:text-red-300 disabled:opacity-50"
                      title="Удалить бридж"
                      aria-label="Удалить"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </LiveBeatProvider>
        </div>
      )}
    </div>
  );
}
