"use client";

import React, { useState, useCallback } from "react";

import { usePlayerStore } from "@/store/playerStore";
import { audioEngine } from "@/lib/audioEngine";
import type { GridMap } from "@/types";
import { LiveBeatProvider, LiveBeatBlock, BridgeHereButton } from "./LiveBeatContext";


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
  const [rawAnalysisOpen, setRawAnalysisOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("rawAnalysisOpen") !== "false";
  });

  // История трека
  const [trackLogs, setTrackLogs] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/log`, { cache: "no-store" });
      if (res.ok) setTrackLogs(await res.json());
    } finally {
      setLoadingHistory(false);
    }
  }, [currentTrack.id]);

  const toggleHistory = () => {
    if (!showHistory) fetchHistory();
    setShowHistory((v) => !v);
  };
  const [isAnalyzingV2, setIsAnalyzingV2] = useState(false);
  const [v2Stage, setV2Stage] = useState("");
  const [isFingerprintLoading, setIsFingerprintLoading] = useState(false);
  const [fingerprintStatus, setFingerprintStatus] = useState<string | null>(null);
  const [isWaveformLoading, setIsWaveformLoading] = useState(false);
  const [waveformStatus, setWaveformStatus] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupStatus, setLookupStatus] = useState<string | null>(null);
  const [coverArtUrl, setCoverArtUrl] = useState<string | null>(null);
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

  // Reset fingerprint status on track change
  React.useEffect(() => {
    setFingerprintStatus(null);
    setIsFingerprintLoading(false);
  }, [currentTrack.id]);

  const runWaveform = async () => {
    if (!currentTrack || isWaveformLoading) return;
    setIsWaveformLoading(true);
    setWaveformStatus(null);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/waveform`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      updateCurrentTrack({ ...currentTrack, waveformData: data.waveformData });
      setWaveformStatus(`OK (${data.count} peaks)`);
    } catch (err: any) {
      setWaveformStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsWaveformLoading(false);
    }
  };

  const runLookupMetadata = async () => {
    if (!currentTrack || isLookingUp) return;
    setIsLookingUp(true);
    setLookupStatus("Запрос...");
    setCoverArtUrl(null);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/lookup-metadata`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      if (!data.found) {
        setLookupStatus("Не найдено в AcoustID");
        console.log("[Metadata Lookup] Not found:", data);
        return;
      }

      const best = data.best;
      const savedMark = data.saved ? " ✓ сохранено" : "";
      const status = best
        ? `${best.artist} — ${best.title} (${best.confidence_pct}%)${savedMark}`
        : "Найдено, но без данных";
      setLookupStatus(status);
      if (best?.coverArtUrl) setCoverArtUrl(best.coverArtUrl);

      console.group(`[Metadata Lookup] Track #${data.trackId}: ${data.trackTitle}`);
      console.log("Best match:", best);
      console.log("All candidates:", data.results);
      console.groupEnd();
    } catch (err: any) {
      setLookupStatus(`Ошибка: ${err.message}`);
      console.error("[Metadata Lookup] Error:", err);
    } finally {
      setIsLookingUp(false);
    }
  };

  const runFingerprint = async () => {
    if (!currentTrack || isFingerprintLoading) return;
    setIsFingerprintLoading(true);
    setFingerprintStatus(null);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/fingerprint`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setFingerprintStatus(`OK (${data.duration}s, ${data.fingerprintLength} frames)`);
    } catch (err: any) {
      setFingerprintStatus(`Ошибка: ${err.message}`);
    } finally {
      setIsFingerprintLoading(false);
    }
  };

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
          <div className="flex items-center gap-1.5">
            {/* Lookup metadata (AcoustID + MusicBrainz) */}
            <button
              type="button"
              onClick={runLookupMetadata}
              disabled={isLookingUp}
              title={lookupStatus || "Найти метаданные через AcoustID + MusicBrainz"}
              className="p-1.5 rounded bg-amber-700 hover:bg-amber-600 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Lookup metadata"
            >
              {isLookingUp ? (
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </button>
            {/* Waveform */}
            <button
              type="button"
              onClick={runWaveform}
              disabled={isWaveformLoading}
              title={waveformStatus || "Сгенерировать waveform (форму волны)"}
              className="p-1.5 rounded bg-sky-700 hover:bg-sky-600 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Waveform"
            >
              {isWaveformLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l2 2 2-2v4l2-2 2 2V6" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h2m14 0h2M3 6h2m14 0h2M3 18h2m14 0h2" />
                </svg>
              )}
            </button>
            {/* Fingerprint */}
            <button
              type="button"
              onClick={runFingerprint}
              disabled={isFingerprintLoading}
              title={fingerprintStatus || "Сгенерировать Chromaprint fingerprint"}
              className="p-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-label="Fingerprint"
            >
              {isFingerprintLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
              )}
            </button>
            {/* V2 Analysis */}
            <button
              type="button"
              onClick={runV2Analysis}
              disabled={isAnalyzingV2}
              title="Запустить анализ v2 (ряды + мостики)"
              data-action="analyze-v2"
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
        </div>
        {lookupStatus && (
          <p className={`text-xs truncate mb-1 ${lookupStatus.startsWith("Ошибка") ? "text-red-400" : lookupStatus === "Не найдено в AcoustID" ? "text-yellow-400" : "text-amber-400"}`}>
            🔍 {lookupStatus}
          </p>
        )}
        {coverArtUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverArtUrl}
            alt="Album cover"
            className="w-16 h-16 rounded object-cover mb-1 border border-gray-600"
            onError={() => setCoverArtUrl(null)}
          />
        )}
        {waveformStatus && (
          <p className={`text-xs truncate mb-1 ${waveformStatus.startsWith("OK") ? "text-sky-400" : "text-red-400"}`}>
            WF: {waveformStatus}
          </p>
        )}
        {fingerprintStatus && (
          <p className={`text-xs truncate mb-1 ${fingerprintStatus.startsWith("OK") ? "text-emerald-400" : "text-red-400"}`}>
            FP: {fingerprintStatus}
          </p>
        )}
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

        {v2Result?.error && <p className="text-red-400 text-xs mb-4">{v2Result.error}</p>}

        {/* Таблица лидирующих рядов (Raw Analysis) */}
        {v2Result && !v2Result.error && v2Result.row_analysis && Object.keys(v2Result.row_analysis).length > 0 && (
          <details className="mt-3" open={rawAnalysisOpen} onToggle={(e) => {
            const open = (e.target as HTMLDetailsElement).open;
            setRawAnalysisOpen(open);
            localStorage.setItem("rawAnalysisOpen", String(open));
          }}>
            <summary className="text-xs font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
              Raw Analysis
            </summary>
            <div className="mt-1 overflow-x-auto">
              {v2Result.row_analysis_verdict && (
                <div className="text-xs text-gray-400 mb-1">
                  {(v2Result.row_analysis_verdict.winning_rows ?? [v2Result.row_analysis_verdict.winning_row])
                    .map((r: number, i: number) => {
                      const rd = v2Result.row_analysis[`row_${r}`];
                      return (
                        <span key={r}>
                          {i > 0 && " | "}
                          <span className="text-green-400">Row {r}</span>: {(rd?.madmom_sum ?? 0).toFixed(3)}
                        </span>
                      );
                    })}
                </div>
              )}
              <table className="text-xs w-full border-collapse">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1 px-2">Row</th>
                    <th className="text-right py-1 px-2">Beats</th>
                    <th className="text-right py-1 px-2">Sum</th>
                    <th className="text-right py-1 px-2">Avg</th>
                    <th className="text-right py-1 px-2">Max</th>
                    <th className="text-left py-1 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rowOne = v2Result.row_analysis_verdict?.row_one;
                    const swapped = currentTrack.rowSwapped ?? false;
                    const displayedRaz = swapped && rowOne != null && rowOne >= 1 && rowOne <= 8
                      ? (rowOne <= 4 ? rowOne + 4 : rowOne - 4)
                      : null;
                    const winningRows = v2Result.row_analysis_verdict?.winning_rows
                      ?? (v2Result.row_analysis_verdict?.winning_row != null
                        ? [v2Result.row_analysis_verdict.winning_row] : []);
                    return Object.entries(v2Result.row_analysis as Record<string, { count: number; madmom_sum: number; madmom_avg: number; madmom_max: number }>)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, row]) => {
                        const rowNum = parseInt(key.replace("row_", ""), 10);
                        const isWinner = winningRows.includes(rowNum);
                        const isRowOne = rowOne != null && rowNum === rowOne;
                        const isSwappedRaz = displayedRaz != null && rowNum === displayedRaz;
                        return (
                          <tr key={key} className={`border-b border-gray-800 ${
                            isSwappedRaz ? "bg-orange-900/20 text-orange-300"
                              : isWinner ? "bg-green-900/20 text-green-300"
                              : "text-gray-300"
                          }`}>
                            <td className="py-1 px-2 font-mono">{rowNum}</td>
                            <td className="py-1 px-2 text-right font-mono">{row.count}</td>
                            <td className="py-1 px-2 text-right font-mono">{row.madmom_sum?.toFixed(3)}</td>
                            <td className="py-1 px-2 text-right font-mono">{row.madmom_avg?.toFixed(3)}</td>
                            <td className="py-1 px-2 text-right font-mono">{row.madmom_max?.toFixed(3)}</td>
                            <td className="py-1 px-2">
                              {isSwappedRaz ? <span className="text-orange-400 font-bold" title="Свапнутый ряд">&lt;&lt;</span>
                                : isRowOne && !swapped ? "<<" : ""}
                            </td>
                          </tr>
                        );
                      });
                  })()}
                </tbody>
              </table>
              {/* Сравнение РАЗ vs ПЯТЬ */}
              {v2Result.row_analysis_verdict && (() => {
                const winningRows = v2Result.row_analysis_verdict.winning_rows
                  ?? (v2Result.row_analysis_verdict.winning_row != null
                    ? [v2Result.row_analysis_verdict.winning_row] : []);
                if (winningRows.length < 2) return null;
                const rowOne = v2Result.row_analysis_verdict.row_one;
                const r1 = rowOne != null && winningRows.includes(rowOne) ? rowOne : winningRows[0];
                const r2 = winningRows.find((r: number) => r !== r1) ?? winningRows[1];
                const r1m = v2Result.row_analysis[`row_${r1}`]?.madmom_sum ?? 0;
                const r2m = v2Result.row_analysis[`row_${r2}`]?.madmom_sum ?? 0;
                const diff = r2m !== 0 ? ((r1m - r2m) / Math.abs(r2m)) * 100 : 0;
                const fmt = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
                const cls = (n: number) => n >= 0 ? "text-green-400" : "text-red-400";
                return (
                  <p className="text-xs text-gray-400 mt-1">
                    Мадмом: РАЗ={r1m.toFixed(3)}, ПЯТЬ={r2m.toFixed(3)} → <span className={cls(diff)}>{fmt(diff)}</span>
                  </p>
                );
              })()}
              {v2Result.per_beat_data?.length > 0 && (
                <button
                  onClick={() => {
                    const title = currentTrack.title
                      .substring(0, 40).replace(/[^\w\s-]/g, "").trim()
                      .replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toLowerCase();
                    const bom = "\ufeff";
                    const header = "Beat,Time_sec,Energy,Perceptual_Energy,Madmom,Local_BPM\n";
                    const rows = v2Result.per_beat_data
                      .map((b: any) =>
                        `${b.id},${b.time.toFixed(3)},${b.energy.toFixed(6)},${(b.perceptual_energy ?? 0).toFixed(3)},${b.madmom_score.toFixed(4)},${(b.local_bpm ?? 0).toFixed(1)}`)
                      .join("\n");
                    const blob = new Blob([bom + header + rows], { type: "text/csv;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `beats_v2${title ? `_${title}` : ""}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="mt-1 px-2 py-1 rounded text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 cursor-pointer"
                  title="Beat, Time_sec, Energy, Perceptual_Energy, Madmom, Local_BPM — UTF-8 с BOM"
                >
                  ↓ CSV побитов
                </button>
              )}
            </div>
          </details>
        )}
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

      {/* История трека */}
      <div className="mt-4 border-t border-gray-700/50 pt-3">
        <button
          type="button"
          onClick={toggleHistory}
          className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg className={`w-3 h-3 transition-transform ${showHistory ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          История трека
          {loadingHistory && <span className="text-gray-600">...</span>}
        </button>
        {showHistory && (
          <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
            {trackLogs.length === 0 && !loadingHistory && (
              <p className="text-xs text-gray-600 py-2">Нет событий</p>
            )}
            {trackLogs.map((log: any) => (
              <div key={log.id} className="flex items-start gap-2 text-xs">
                <span className="text-gray-600 whitespace-nowrap pt-0.5">
                  {new Date(log.createdAt).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" })}{" "}
                  {new Date(log.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium border ${
                  log.event === "mod_verdict_correct" ? "bg-green-900/50 text-green-400 border-green-800" :
                  log.event === "mod_verdict_incorrect" ? "bg-amber-900/50 text-amber-400 border-amber-800" :
                  log.event === "mod_verdict_incorrect_again" ? "bg-red-900/50 text-red-400 border-red-800" :
                  log.event === "rows_swapped" ? "bg-orange-900/50 text-orange-400 border-orange-800" :
                  log.event === "status_change" ? "bg-purple-900/50 text-purple-400 border-purple-800" :
                  log.event === "analyzer_done" ? "bg-blue-900/50 text-blue-400 border-blue-800" :
                  "bg-gray-800 text-gray-500 border-gray-700"
                }`}>
                  {log.event.replace(/_/g, " ")}
                </span>
                {log.userEmail && <span className="text-gray-600 truncate">{log.userEmail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
