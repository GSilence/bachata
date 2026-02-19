"use client";

import { useState, useEffect, useRef } from "react";
import { usePlayerStore } from "@/store/playerStore";
import { useAuthStore } from "@/store/authStore";
import { audioEngine } from "@/lib/audioEngine";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { GridMap } from "@/types";

const DashboardChart = dynamic(() => import("./DashboardChart"), {
  ssr: false,
});
const BridgeAnalysisChart = dynamic(
  () => import("./charts/BridgeAnalysisChart"),
  { ssr: false },
);
const V2AnalysisDisplay = dynamic(() => import("./charts/V2AnalysisDisplay"), {
  ssr: false,
});

/** Отключено: корреляционный анализ не показывается и не запускается. Включить обратно — поменять на true. */
const ENABLE_CORRELATION_ANALYSIS = false;

interface TrackInfoProps {}

export default function TrackInfo({}: TrackInfoProps) {
  const {
    currentTrack,
    setCurrentTrack,
    updateCurrentTrack,
    tracks,
    setTracks,
    stop,
    isPlaying,
    isReanalyzing,
    setReanalyzing,
  } = usePlayerStore();
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "admin";
  const [editingBpm, setEditingBpm] = useState(false);
  const [editingOffset, setEditingOffset] = useState(false);
  const [tempBpm, setTempBpm] = useState(currentTrack?.bpm.toString() || "120");
  const [tempOffset, setTempOffset] = useState(
    currentTrack?.offset.toString() || "0",
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [isShifting, setIsShifting] = useState(false);

  // Structure analysis (MSAF) state
  const [structureResult, setStructureResult] = useState<any>(null);
  const [isAnalyzingStructure, setIsAnalyzingStructure] = useState(false);

  // Bridge analysis (Spleeter/HPSS) state
  const [bridgeResult, setBridgeResult] = useState<any>(null);
  const [isAnalyzingBridges, setIsAnalyzingBridges] = useState(false);

  // V2 analysis state
  const [v2Result, setV2Result] = useState<any>(null);
  const [isAnalyzingV2, setIsAnalyzingV2] = useState(false);

  // Bridge state
  const [bridges, setBridges] = useState<number[]>([]);
  const [isSavingBridge, setIsSavingBridge] = useState(false);
  const [liveBeatInfo, setLiveBeatInfo] = useState<{
    time: number;
    number: number;
    isBridge: boolean;
  } | null>(null);
  const liveBeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Скачать биты как CSV (номер бита + энергия)
  const downloadBeatsCSV = async (reportPath: string) => {
    try {
      const res = await fetch(`${reportPath}?t=${Date.now()}`);
      if (!res.ok) throw new Error("Failed to fetch report");
      const report = await res.json();
      const beats = report.beats;
      if (!beats || !Array.isArray(beats)) throw new Error("No beats data");

      const bom = "\uFEFF";
      const header =
        "Beat,Energy,Madmom,Harmonic,BPM,Intensity,Centroid,Flatness,Onset_str,ZCR";
      const rows = beats.map(
        (b: any) =>
          `${b.id + 1},${b.energy},${b.madmom_score},${b.harmonic ?? ""},${b.local_bpm ?? ""},${b.intensity ?? ""},${b.spectral_centroid ?? ""},${b.spectral_flatness ?? ""},${b.onset_strength ?? ""},${b.zcr ?? ""}`,
      );
      const csv = bom + header + "\n" + rows.join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const trackName =
        currentTrack?.title?.replace(/[^a-zA-Z0-9а-яА-Я]/g, "_") || "beats";
      a.download = `${trackName}_beats.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV export error:", err);
      alert("Ошибка при экспорте CSV");
    }
  };

  // Обновляем временные значения при смене трека
  useEffect(() => {
    if (currentTrack) {
      setTempBpm(currentTrack.bpm.toString());
      setTempOffset(currentTrack.offset.toString());
      setEditingBpm(false);
      setEditingOffset(false);
      const gridMap = currentTrack.gridMap as GridMap | null;
      setBridges(gridMap?.bridges || []);
    }
  }, [currentTrack]);

  // Обновляем live beat info во время воспроизведения
  useEffect(() => {
    if (isPlaying && currentTrack) {
      liveBeatRef.current = setInterval(() => {
        const info = audioEngine.getCurrentBeatInfo();
        setLiveBeatInfo(info);
      }, 50);
    } else {
      if (liveBeatRef.current) {
        clearInterval(liveBeatRef.current);
        liveBeatRef.current = null;
      }
      // При паузе — оставляем последний бит как есть (liveBeatInfo не сбрасываем)
      // Бит 1 показываем только при первой загрузке трека (когда liveBeatInfo ещё null)
    }
    return () => {
      if (liveBeatRef.current) {
        clearInterval(liveBeatRef.current);
        liveBeatRef.current = null;
      }
    };
  }, [isPlaying, currentTrack]);

  // При смене трека — показываем бит 1 + загружаем сохранённые результаты анализов
  useEffect(() => {
    if (currentTrack) {
      setLiveBeatInfo({
        time: currentTrack.offset,
        number: 1,
        isBridge: false,
      });
      // Reset and load saved analysis results
      setStructureResult(null);
      setBridgeResult(null);
      // Load saved structure analysis
      fetch(`/api/tracks/${currentTrack.id}/structure`)
        .then((r) => r.json())
        .then((data) => {
          if (data.found) setStructureResult(data);
        })
        .catch(() => {});
      // Load saved bridge analysis
      fetch(`/api/tracks/${currentTrack.id}/bridge-analysis`)
        .then((r) => r.json())
        .then((data) => {
          if (data.found) setBridgeResult(data);
        })
        .catch(() => {});
      // Load saved v2 analysis (GET также считает rowDominancePercent из Row Analysis и пишет в БД)
      fetch(`/api/tracks/${currentTrack.id}/analyze-v2`)
        .then((r) => r.json())
        .then((data) => {
          if (data.found) setV2Result(data);
          if (
            data.found &&
            typeof data.rowDominancePercent === "number" &&
            currentTrack
          ) {
            const existing =
              (currentTrack.gridMap as unknown as Record<string, unknown>) ||
              {};
            const mergedGridMap: GridMap = {
              ...(currentTrack.gridMap || {}),
              rowDominancePercent: data.rowDominancePercent,
            } as GridMap;
            const updatedTrack = {
              ...currentTrack,
              gridMap: mergedGridMap,
            };
            updateCurrentTrack(updatedTrack);
            const currentTracks = usePlayerStore.getState().tracks;
            setTracks(
              currentTracks.map((t) =>
                t.id === currentTrack.id ? updatedTrack : t,
              ),
            );
          }
        })
        .catch(() => {});
    } else {
      setLiveBeatInfo(null);
      setStructureResult(null);
      setBridgeResult(null);
      setV2Result(null);
    }
  }, [currentTrack?.id]);

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
    const updatedTrack = { ...currentTrack, bpm: newBpm };
    setCurrentTrack(updatedTrack);
    console.log("BPM changed to:", newBpm);
  };

  const handleOffsetChange = async (newOffset: number) => {
    if (!currentTrack) return;
    const updatedTrack = { ...currentTrack, offset: newOffset };
    setCurrentTrack(updatedTrack);
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

  const handleDelete = async () => {
    if (!currentTrack || isDeleting) return;

    if (
      !confirm(
        `Вы уверены, что хотите удалить трек "${currentTrack.title}"? Это действие нельзя отменить.`,
      )
    ) {
      return;
    }

    setIsDeleting(true);

    try {
      stop();

      const response = await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete track");
      }

      const updatedTracks = tracks.filter((t) => t.id !== currentTrack.id);
      setTracks(updatedTracks);
      setCurrentTrack(null);
      router.refresh();
    } catch (error) {
      console.error("Error deleting track:", error);
      alert(
        `Ошибка при удалении трека: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const analysisCompleted =
    currentTrack &&
    (currentTrack.analyzerType === "v2" ||
      currentTrack.analyzerType === "basic" ||
      currentTrack.analyzerType === "extended" ||
      currentTrack.analyzerType === "correlation");

  // 1 Доля = 1 такт = 4 бита, 1 Счёт = 1 бит
  const beatInterval =
    currentTrack && currentTrack.bpm > 0 ? 60 / currentTrack.bpm : 0;
  const shiftBeat = beatInterval * 4; // 1 доля = 1 такт = 4 бита
  const shiftCount = beatInterval; // 1 счёт = 1 бит
  const hasBridges = bridges.length > 0;

  const handleGridShift = async (
    direction: "back" | "forward",
    amount?: number,
  ) => {
    if (!currentTrack || isShifting || !analysisCompleted) return;
    if (hasBridges) return; // Сдвиг сетки блокирован при наличии бриджей

    const shift = amount ?? shiftBeat;
    const newOffset =
      direction === "forward"
        ? currentTrack.offset + shift
        : currentTrack.offset - shift;

    if (newOffset < 0) return;

    setIsShifting(true);
    try {
      const res = await fetch("/api/rhythm/update-offset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track_id: currentTrack.id,
          new_offset: newOffset,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Ошибка сдвига сетки");
      if (data.track) {
        updateCurrentTrack(data.track);
        audioEngine.reloadBeatGrid(data.track);
      }
      setTempOffset(data.track.offset.toString());
    } catch (e) {
      console.error("Grid shift failed:", e);
      alert(
        `Ошибка при сдвиге сетки: ${
          e instanceof Error ? e.message : "Unknown error"
        }`,
      );
    } finally {
      setIsShifting(false);
    }
  };

  const handleReanalyze = async (
    analyzer: "basic" | "extended" | "correlation",
  ) => {
    if (!currentTrack || isReanalyzing) return;
    setReanalyzing(true);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/reanalyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzer }),
      });
      if (!res.ok) {
        const text = await res.text();
        let errMsg = "Ошибка перезапуска анализа";
        try {
          errMsg = JSON.parse(text).error || errMsg;
        } catch {
          errMsg = text.slice(0, 200);
        }
        throw new Error(errMsg);
      }
      const data = await res.json();
      const listRes = await fetch("/api/tracks", { cache: "no-store" });
      const list = await listRes.json();
      if (Array.isArray(list)) setTracks(list);
      const updated = list?.find(
        (t: { id: number }) => t.id === currentTrack.id,
      );
      if (updated) setCurrentTrack(updated);
    } catch (e) {
      console.error("Reanalyze failed:", e);
      alert(
        `Ошибка при перезапуске анализа: ${
          e instanceof Error ? e.message : "Unknown error"
        }`,
      );
    } finally {
      setReanalyzing(false);
    }
  };

  // === Structure analysis (MSAF) ===
  const handleStructureAnalysis = async () => {
    if (!currentTrack || isAnalyzingStructure) return;
    setIsAnalyzingStructure(true);
    setStructureResult(null);
    try {
      const res = await fetch(`/api/tracks/${currentTrack.id}/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const text = await res.text();
        let errMsg = "Structure analysis failed";
        try {
          errMsg = JSON.parse(text).error || errMsg;
        } catch {
          errMsg = text.slice(0, 200);
        }
        throw new Error(errMsg);
      }
      const data = await res.json();
      setStructureResult(data);
    } catch (e) {
      console.error("Structure analysis failed:", e);
      alert(
        `Ошибка структурного анализа: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    } finally {
      setIsAnalyzingStructure(false);
    }
  };

  // === Bridge deep analysis (Spleeter/HPSS) ===
  const handleBridgeAnalysis = async () => {
    if (!currentTrack || isAnalyzingBridges) return;
    setIsAnalyzingBridges(true);
    setBridgeResult(null);
    try {
      const res = await fetch(
        `/api/tracks/${currentTrack.id}/bridge-analysis`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!res.ok) {
        const text = await res.text();
        let errMsg = "Bridge analysis failed";
        try {
          errMsg = JSON.parse(text).error || errMsg;
        } catch {
          errMsg = text.slice(0, 200);
        }
        throw new Error(errMsg);
      }
      const data = await res.json();
      setBridgeResult(data);
    } catch (e) {
      console.error("Bridge analysis failed:", e);
      alert(
        `Ошибка анализа мостиков: ${e instanceof Error ? e.message : "Unknown error"}`,
      );
    } finally {
      setIsAnalyzingBridges(false);
    }
  };

  // === Bridge handlers ===

  const saveBridges = async (newBridges: number[]) => {
    if (!currentTrack) return;
    setIsSavingBridge(true);
    try {
      const res = await fetch("/api/rhythm/update-bridges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          track_id: currentTrack.id,
          bridges: newBridges,
        }),
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

  const handleAddBridgeHere = () => {
    if (!currentTrack || isSavingBridge || !liveBeatInfo) return;

    // Используем время бита из линейки — это именно то, что видит админ
    const bridgeTime = liveBeatInfo.time;
    const beatInterval = 60 / currentTrack.bpm;

    // Проверка дубликатов (в пределах половины бита)
    if (bridges.some((b) => Math.abs(b - bridgeTime) < beatInterval / 2)) {
      alert("Бридж уже существует рядом с этой позицией");
      return;
    }

    const newBridges = [...bridges, bridgeTime].sort((a, b) => a - b);
    saveBridges(newBridges);
  };

  const handleRemoveBridge = (bridgeTime: number) => {
    const newBridges = bridges.filter((b) => b !== bridgeTime);
    saveBridges(newBridges);
  };

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = (seconds % 60).toFixed(1);
    return `${min}:${sec.padStart(4, "0")}`;
  };

  return (
    <div
      className="bg-gray-800 rounded-lg p-4 sm:p-6 border border-gray-700"
      data-component="track-info"
    >
      {/* Название и исполнитель */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-1">
            {currentTrack.title}
          </h2>
          {currentTrack.artist && (
            <p className="text-gray-400">{currentTrack.artist}</p>
          )}
          {currentTrack.genreHint && (
            <span
              className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                currentTrack.genreHint === "bachata" ||
                currentTrack.genreHint === "latin"
                  ? "bg-green-900/40 text-green-400 border border-green-700/50"
                  : "bg-gray-700/40 text-gray-400 border border-gray-600/50"
              }`}
            >
              {currentTrack.genreHint}
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Удалить трек"
            aria-label="Удалить трек"
          >
            {isDeleting ? (
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Расклад анализа, сдвиг сетки, BPM/Offset (только для админа) */}
      {isAdmin && (
        <>
          <div className="mt-4 sm:mt-6 mb-4 sm:mb-6 flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-400">Расклад:</span>
            <span className="text-sm text-white">
              {currentTrack.analyzerType === "v2"
                ? "v2 (ряды + мостики)"
                : ENABLE_CORRELATION_ANALYSIS &&
                    currentTrack.analyzerType === "correlation"
                  ? "Корреляция"
                  : currentTrack.analyzerType || "не указан"}
            </span>
            <div className="flex items-center gap-2 ml-2">
              {ENABLE_CORRELATION_ANALYSIS && (
                <button
                  type="button"
                  onClick={() => handleReanalyze("correlation")}
                  disabled={isReanalyzing}
                  title="Запустить корреляционный анализ"
                  className={`text-xs px-2 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-200 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5 min-w-[7rem] ${
                    isReanalyzing ? "opacity-50" : ""
                  }`}
                >
                  {isReanalyzing ? (
                    <svg
                      className="w-4 h-4 animate-spin shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  ) : null}
                  {isReanalyzing ? "Анализ…" : "Корреляция"}
                </button>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (!currentTrack || isAnalyzingV2) return;
                  setIsAnalyzingV2(true);
                  setV2Result(null);
                  try {
                    const res = await fetch(
                      `/api/tracks/${currentTrack.id}/analyze-v2`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                      },
                    );
                    const data = await res.json();
                    setV2Result(data);
                    // Сразу применяем раскладку v2 к воспроизведению (мостики учтены в счёте)
                    if (
                      currentTrack &&
                      data.success &&
                      Array.isArray(data.layout) &&
                      data.layout.length > 0
                    ) {
                      const existing =
                        currentTrack.gridMap as unknown as Record<
                          string,
                          unknown
                        > | null;
                      const base =
                        existing && typeof existing === "object"
                          ? { ...existing }
                          : {};
                      const squareAnalysis = data.square_analysis as
                        | { verdict?: string; row_dominance_pct?: number }
                        | undefined;
                      const rowDominancePercent =
                        typeof squareAnalysis?.row_dominance_pct === "number"
                          ? squareAnalysis.row_dominance_pct
                          : undefined;
                      const mergedGridMap: GridMap = {
                        bpm: (data.bpm ?? currentTrack.bpm) as number,
                        offset: (currentTrack.offset ??
                          base.offset ??
                          0) as number,
                        grid: (base.grid as GridMap["grid"]) ?? [],
                        bridges: Array.isArray(data.bridges)
                          ? data.bridges.map(
                              (b: { time_sec?: number }) => b.time_sec ?? 0,
                            )
                          : (base.bridges as number[] | undefined),
                        duration: (data.duration ?? base.duration) as
                          | number
                          | undefined,
                        v2Layout: data.layout as GridMap["v2Layout"],
                        ...(rowDominancePercent != null && {
                          rowDominancePercent,
                        }),
                      };
                      const updatedTrack = {
                        ...currentTrack,
                        gridMap: mergedGridMap,
                      };
                      updateCurrentTrack(updatedTrack);
                      audioEngine.reloadBeatGrid(updatedTrack);
                      setTracks(
                        tracks.map((t) =>
                          t.id === currentTrack.id ? updatedTrack : t,
                        ),
                      );
                    }
                  } catch (e) {
                    console.error("V2 analysis error:", e);
                    setV2Result({ error: String(e) });
                  } finally {
                    setIsAnalyzingV2(false);
                  }
                }}
                disabled={isAnalyzingV2}
                title="Запустить анализ v2 (ряды + мостики)"
                className={`text-xs px-2 py-1.5 rounded bg-indigo-700 hover:bg-indigo-600 text-gray-200 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5 min-w-[7rem] ${
                  isAnalyzingV2 ? "opacity-50" : ""
                }`}
              >
                {isAnalyzingV2 ? (
                  <svg
                    className="w-4 h-4 animate-spin shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                ) : null}
                {isAnalyzingV2 ? "Анализ v2…" : "Анализ v2"}
              </button>
            </div>
          </div>

          {/* Корреляционный анализ: таблица рядов (отключено через ENABLE_CORRELATION_ANALYSIS) */}
          {ENABLE_CORRELATION_ANALYSIS &&
            currentTrack.analyzerType === "correlation" &&
            currentTrack.gridMap &&
            (currentTrack.gridMap as any).correlationAnalysis &&
            (() => {
              const ca = (currentTrack.gridMap as any).correlationAnalysis;
              const verdict = ca.verdict;
              const rowAnalysis = ca.row_analysis;
              if (!rowAnalysis) return null;
              const rows = Object.entries(
                rowAnalysis as Record<string, any>,
              ).sort(([a], [b]) => a.localeCompare(b));
              return (
                <div className="mb-4 sm:mb-6">
                  <details className="group">
                    <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
                      Row Analysis{" "}
                      {verdict && (
                        <span className="text-green-400 ml-1">
                          (Row {verdict.winning_row})
                        </span>
                      )}
                    </summary>
                    <div className="mt-2 overflow-x-auto">
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
                          {rows.map(([key, row]: [string, any]) => {
                            const rowNum = parseInt(key.replace("row_", ""));
                            const isWinner =
                              verdict && rowNum === verdict.winning_row;
                            return (
                              <tr
                                key={key}
                                className={`border-b border-gray-800 ${isWinner ? "bg-green-900/20 text-green-300" : "text-gray-300"}`}
                              >
                                <td className="py-1 px-2 font-mono">
                                  {rowNum}
                                </td>
                                <td className="py-1 px-2 text-right font-mono">
                                  {row.count}
                                </td>
                                <td className="py-1 px-2 text-right font-mono">
                                  {row.madmom_sum?.toFixed(3)}
                                </td>
                                <td className="py-1 px-2 text-right font-mono">
                                  {row.madmom_avg?.toFixed(3)}
                                </td>
                                <td className="py-1 px-2 text-right font-mono">
                                  {row.madmom_max?.toFixed(3)}
                                </td>
                                <td className="py-1 px-2">
                                  {isWinner ? "<<" : ""}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {verdict && (
                        <div className="text-xs text-gray-500 mt-2 space-y-1">
                          <p>
                            Offset: {verdict.start_time}s (beat #
                            {verdict.start_beat_id})
                            {verdict.diff_percent !== undefined && (
                              <span className="ml-2">
                                | Diff:{" "}
                                <span
                                  className={
                                    verdict.diff_percent >= 5
                                      ? "text-green-400"
                                      : "text-yellow-400"
                                  }
                                >
                                  {verdict.diff_percent.toFixed(1)}%
                                </span>
                              </span>
                            )}
                          </p>
                          {verdict.bridge_times_full &&
                            verdict.bridge_times_full.length > 0 && (
                              <p className="text-yellow-400/80">
                                <span className="text-gray-500">
                                  Bridges (Full):
                                </span>{" "}
                                {verdict.bridge_times_full
                                  .map((t: number) => `${t}s`)
                                  .join(", ")}
                              </p>
                            )}
                          {verdict.break_times_full &&
                            verdict.break_times_full.length > 0 && (
                              <p className="text-orange-400/80">
                                <span className="text-gray-500">
                                  Breaks (Full):
                                </span>{" "}
                                {verdict.break_times_full
                                  .map((t: number) => `${t}s`)
                                  .join(", ")}
                              </p>
                            )}
                          {verdict.bridge_times_strong &&
                            verdict.bridge_times_strong.length > 0 && (
                              <p className="text-yellow-300/80">
                                <span className="text-gray-500">
                                  Bridges (Strong):
                                </span>{" "}
                                {verdict.bridge_times_strong
                                  .map((t: number) => `${t}s`)
                                  .join(", ")}
                              </p>
                            )}
                          {verdict.break_times_strong &&
                            verdict.break_times_strong.length > 0 && (
                              <p className="text-orange-300/80">
                                <span className="text-gray-500">
                                  Breaks (Strong):
                                </span>{" "}
                                {verdict.break_times_strong
                                  .map((t: number) => `${t}s`)
                                  .join(", ")}
                              </p>
                            )}
                          {verdict.bridge_detection && (
                            <div className="space-y-0.5">
                              {(["bd2", "bd3", "bd5"] as const).map((key) => {
                                const bd = (
                                  verdict.bridge_detection as Record<
                                    string,
                                    any
                                  >
                                )?.[key];
                                if (!bd) return null;
                                const label =
                                  key === "bd2"
                                    ? "BD-2"
                                    : key === "bd3"
                                      ? "BD-3"
                                      : "BD-5";
                                return (
                                  <p
                                    key={key}
                                    className={
                                      bd.has_bridge
                                        ? "text-red-400"
                                        : "text-green-400/80"
                                    }
                                  >
                                    <span className="text-gray-500">
                                      {label}:
                                    </span>{" "}
                                    {bd.summary}
                                  </p>
                                );
                              })}
                            </div>
                          )}
                          {ca.reportPath && (
                            <div className="flex flex-wrap gap-3 mt-1">
                              <a
                                href={ca.reportPath}
                                download
                                className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                <svg
                                  className="w-3 h-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                  />
                                </svg>
                                Скачать биты (JSON)
                              </a>
                              <button
                                onClick={() => downloadBeatsCSV(ca.reportPath)}
                                className="inline-flex items-center gap-1 text-green-400 hover:text-green-300 hover:underline"
                              >
                                <svg
                                  className="w-3 h-3"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                  />
                                </svg>
                                Скачать биты (CSV)
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>

                  {/* Dashboard Charts (Librosa) */}
                  {ca.reportPath && (
                    <DashboardChart reportPath={ca.reportPath} />
                  )}

                  {/* Structure Analysis (MSAF) */}
                  <details className="group mt-3">
                    <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
                      Structure Analysis
                      {structureResult && (
                        <span className="text-cyan-400 ml-1 text-xs">
                          ({structureResult.total_sections} sections,{" "}
                          {structureResult.algorithm})
                        </span>
                      )}
                    </summary>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={handleStructureAnalysis}
                        disabled={isAnalyzingStructure}
                        className={`text-xs px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 text-white transition-colors inline-flex items-center gap-1.5 ${
                          isAnalyzingStructure
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                      >
                        {isAnalyzingStructure && (
                          <svg
                            className="w-4 h-4 animate-spin shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        )}
                        {isAnalyzingStructure
                          ? "Анализ структуры…"
                          : "Запустить анализ структуры"}
                      </button>

                      {structureResult && !structureResult.error && (
                        <div className="mt-3 space-y-2">
                          {/* Structure visualization PNG */}
                          {structureResult.structure_png && (
                            <div className="flex justify-center">
                              <img
                                src={`${structureResult.structure_png}?t=${Date.now()}`}
                                alt="Structure Segmentation"
                                className="rounded max-w-full"
                              />
                            </div>
                          )}

                          {/* Sections list */}
                          <div className="space-y-1 max-h-64 overflow-y-auto">
                            {structureResult.sections?.map(
                              (sec: any, i: number) => (
                                <div
                                  key={i}
                                  className={`flex items-center gap-3 text-xs px-2 py-1 rounded bg-gray-800/50 ${
                                    sec.possible_bridge
                                      ? "text-amber-400"
                                      : "text-gray-300"
                                  }`}
                                >
                                  <span className="font-mono w-16 text-gray-500">
                                    {Math.floor(sec.start_time / 60)}:
                                    {Math.floor(sec.start_time % 60)
                                      .toString()
                                      .padStart(2, "0")}
                                    –{Math.floor(sec.end_time / 60)}:
                                    {Math.floor(sec.end_time % 60)
                                      .toString()
                                      .padStart(2, "0")}
                                  </span>
                                  <span className="font-bold w-6">
                                    {sec.label}
                                  </span>
                                  <span className="text-gray-500">
                                    {sec.duration?.toFixed(1)}s
                                  </span>
                                  {sec.possible_bridge && (
                                    <span className="text-xs px-1.5 rounded bg-amber-900/40 text-amber-300">
                                      Bridge?
                                    </span>
                                  )}
                                </div>
                              ),
                            )}
                          </div>

                          {/* Legend */}
                          <div className="text-xs text-gray-500 mt-2">
                            <p>
                              A/B/C — различные секции. Повтор (A-B-A-B) =
                              куплет-припев.
                            </p>
                            <p>
                              Bridge? — короткий переход между длинными секциями
                              (Parada/Yamasi).
                            </p>
                          </div>
                        </div>
                      )}

                      {structureResult?.error && (
                        <p className="text-red-400 text-xs mt-2">
                          {structureResult.error}
                        </p>
                      )}
                    </div>
                  </details>

                  {/* Bridge Deep Analysis (Spleeter/HPSS) */}
                  <details className="group mt-3">
                    <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
                      Bridge Detection (Sherlock)
                      {bridgeResult && !bridgeResult.error && (
                        <span className="text-amber-400 ml-1 text-xs">
                          ({bridgeResult.bridges_count} bridge
                          {bridgeResult.bridges_count !== 1 ? "s" : ""},{" "}
                          {bridgeResult.separation_method})
                        </span>
                      )}
                    </summary>
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={handleBridgeAnalysis}
                        disabled={isAnalyzingBridges}
                        className={`text-xs px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white transition-colors inline-flex items-center gap-1.5 ${
                          isAnalyzingBridges
                            ? "opacity-50 cursor-not-allowed"
                            : ""
                        }`}
                      >
                        {isAnalyzingBridges && (
                          <svg
                            className="w-4 h-4 animate-spin shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                            />
                          </svg>
                        )}
                        {isAnalyzingBridges
                          ? "Анализ мостиков…"
                          : "Запустить Sherlock"}
                      </button>

                      {bridgeResult && !bridgeResult.error && (
                        <div className="mt-3 space-y-3">
                          {/* Interactive stems energy chart */}
                          {bridgeResult.stems_energy?.length > 0 && (
                            <BridgeAnalysisChart
                              stemsEnergy={bridgeResult.stems_energy}
                              bridges={bridgeResult.bridges || []}
                            />
                          )}

                          {/* Static PNG fallback/supplement */}
                          {bridgeResult.visualization && (
                            <details className="group">
                              <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                                PNG визуализация (по стемам отдельно)
                              </summary>
                              <div className="flex justify-center mt-1">
                                <img
                                  src={`${bridgeResult.visualization}?t=${Date.now()}`}
                                  alt="Bridge Detection Stems"
                                  className="rounded max-w-full"
                                />
                              </div>
                            </details>
                          )}

                          {/* Bridges list */}
                          {bridgeResult.bridges?.length > 0 ? (
                            <div className="space-y-1">
                              <p className="text-xs text-gray-400 font-medium">
                                Найдено мостиков: {bridgeResult.bridges_count}
                              </p>
                              {bridgeResult.bridges.map((b: any, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-3 text-xs px-2 py-1.5 rounded bg-gray-800/50 text-amber-300"
                                >
                                  <span className="font-bold text-amber-400">
                                    #{i + 1}
                                  </span>
                                  <span className="font-mono text-gray-400">
                                    {Math.floor(b.start_time / 60)}:
                                    {Math.floor(b.start_time % 60)
                                      .toString()
                                      .padStart(2, "0")}
                                    –{Math.floor(b.end_time / 60)}:
                                    {Math.floor(b.end_time % 60)
                                      .toString()
                                      .padStart(2, "0")}
                                  </span>
                                  <span className="text-gray-500">
                                    {b.duration.toFixed(1)}s
                                  </span>
                                  <span className="text-gray-500">
                                    beats {b.beat_start}–{b.beat_end}
                                  </span>
                                  <span className="text-xs px-1.5 rounded bg-gray-700 text-gray-300">
                                    {b.stems_triggered.join(" + ")}
                                  </span>
                                  <span
                                    className={`text-xs px-1.5 rounded ${
                                      b.confidence > 0.7
                                        ? "bg-red-900/40 text-red-300"
                                        : "bg-yellow-900/40 text-yellow-300"
                                    }`}
                                  >
                                    {(b.confidence * 100).toFixed(0)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-gray-500 text-xs">
                              Мостиков не обнаружено (threshold:{" "}
                              {bridgeResult.threshold}).
                            </p>
                          )}

                          {/* Info */}
                          <div className="text-xs text-gray-500">
                            <p>
                              Метод:{" "}
                              {bridgeResult.separation_method === "demucs"
                                ? "Demucs htdemucs"
                                : bridgeResult.separation_method === "spleeter"
                                  ? "Spleeter 4stems"
                                  : "HPSS fallback (librosa)"}
                              .
                            </p>
                            <p>
                              Алгоритм: Bass Hole + Other Hole + Vocal Dropoff →
                              голосование (2+ из 3 = Bridge).
                            </p>
                          </div>
                        </div>
                      )}

                      {bridgeResult?.error && (
                        <p className="text-red-400 text-xs mt-2">
                          {bridgeResult.error}
                        </p>
                      )}
                    </div>
                  </details>
                </div>
              );
            })()}

          {/* V2 Analysis results */}
          {v2Result && !v2Result.error && (
            <div className="mb-4 sm:mb-6">
              <details open>
                <summary className="text-sm font-medium text-gray-400 cursor-pointer hover:text-gray-300 select-none">
                  Анализ v2 —{" "}
                  {v2Result.track_type === "popsa" ? "Попса" : "Бачата"}
                  {v2Result.bridges?.length > 0 && (
                    <span className="text-yellow-400 ml-1">
                      ({v2Result.bridges.length} мостик
                      {v2Result.bridges.length > 1 ? "а" : ""})
                    </span>
                  )}
                  {typeof v2Result.square_analysis?.row_dominance_pct ===
                    "number" && (
                    <span
                      className={
                        (v2Result.square_analysis.row_dominance_pct ?? 0) >= 0
                          ? "text-green-400 ml-1"
                          : "text-amber-400 ml-1"
                      }
                    >
                      (разница РАЗ−ПЯТЬ:{" "}
                      {v2Result.square_analysis.row_dominance_pct.toFixed(1)}%)
                    </span>
                  )}
                </summary>
                <div className="mt-2">
                  <V2AnalysisDisplay data={v2Result} />
                </div>
              </details>
            </div>
          )}
          {v2Result?.error && (
            <p className="text-red-400 text-xs mb-4">{v2Result.error}</p>
          )}

          {/* Сдвиг сетки (offset) — заблокирован при наличии бриджей */}
          {analysisCompleted && (
            <div className="mb-4 sm:mb-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-400">
                  Сдвиг сетки:
                </span>
                <button
                  type="button"
                  onClick={() => handleGridShift("back")}
                  disabled={
                    isShifting ||
                    isReanalyzing ||
                    hasBridges ||
                    currentTrack.offset - shiftBeat < 0
                  }
                  title="Сдвинуть сетку на 1 долю назад"
                  className="text-xs px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  {isShifting ? (
                    <svg
                      className="w-4 h-4 animate-spin shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                      />
                    </svg>
                  ) : null}
                  &laquo; -1 Доля
                </button>
                <button
                  type="button"
                  onClick={() => handleGridShift("forward")}
                  disabled={isShifting || isReanalyzing || hasBridges}
                  title="Сдвинуть сетку на 1 долю вперёд"
                  className="text-xs px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-gray-200 disabled:opacity-60 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  +1 Доля &raquo;
                </button>
                <span className="text-gray-600 mx-1">|</span>
                <button
                  type="button"
                  onClick={() => handleGridShift("back", shiftCount)}
                  disabled={
                    isShifting ||
                    isReanalyzing ||
                    hasBridges ||
                    currentTrack.offset - shiftCount < 0
                  }
                  title="Тонкий сдвиг на 1 счёт назад (1/8 доли)"
                  className="text-xs px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  &laquo; -1 Счёт
                </button>
                <button
                  type="button"
                  onClick={() => handleGridShift("forward", shiftCount)}
                  disabled={isShifting || isReanalyzing || hasBridges}
                  title="Тонкий сдвиг на 1 счёт вперёд (1/8 доли)"
                  className="text-xs px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  +1 Счёт &raquo;
                </button>
              </div>
              {hasBridges && (
                <p className="text-xs text-yellow-500/70 mt-1">
                  Сдвиг сетки заблокирован — удалите все бриджи для изменения
                  offset
                </p>
              )}
            </div>
          )}

          {/* Управление бриджами */}
          {analysisCompleted && (
            <div className="mb-4 sm:mb-6">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-sm font-medium text-gray-400">
                  Бриджи:
                </span>
                <button
                  type="button"
                  onClick={handleAddBridgeHere}
                  disabled={isSavingBridge || isReanalyzing}
                  title="Добавить бридж на текущей позиции"
                  className="text-xs px-3 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSavingBridge ? "Сохранение..." : "+ Бридж здесь"}
                </button>
                {v2Result &&
                  !v2Result.error &&
                  v2Result.bridges?.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const times: number[] = v2Result.bridges.map(
                          (b: any) => b.time_sec,
                        );
                        saveBridges(times);
                      }}
                      disabled={isSavingBridge || isReanalyzing}
                      title="Применить мостики из v2 анализа"
                      className="text-xs px-3 py-1.5 rounded bg-purple-700 hover:bg-purple-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSavingBridge
                        ? "Сохранение..."
                        : `← из v2 (${v2Result.bridges.length})`}
                    </button>
                  )}
              </div>

              {/* Линейка битов (live) */}
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
                          // Находим индекс текущего бита в сетке
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
                          const targetIdx = Math.min(
                            grid.length - 1,
                            currentIdx + 1,
                          );
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

              {/* Список бриджей */}
              {bridges.length > 0 && (
                <div className="space-y-1 mt-1">
                  {bridges.map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-yellow-400 font-mono text-xs">
                        {formatTime(b)}
                      </span>
                      <span className="text-gray-500 text-xs">
                        ({b.toFixed(2)}s)
                      </span>
                      <button
                        onClick={() => handleRemoveBridge(b)}
                        disabled={isSavingBridge}
                        className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                        title="Удалить бридж"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Параметры */}
          <div className="space-y-2">
            {/* BPM и Offset в одну строку */}
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-400">BPM:</span>
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
                      className="text-xs text-purple-400 hover:text-purple-300 ml-2 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors hidden"
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

              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-400">
                  Offset:
                </span>
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
                      className="text-xs text-purple-400 hover:text-purple-300 ml-2 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600 transition-colors hidden"
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
            </div>
          </div>
        </>
      )}
    </div>
  );
}
