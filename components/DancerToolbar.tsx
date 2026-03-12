"use client";

import { usePlayerStore } from "@/store/playerStore";
import { useRef, useState, useEffect, useCallback } from "react";
import type { VoiceFilter, VoiceType, VoiceLanguage } from "@/types";

interface DancerToolbarProps {
  beatCounterMode: "inline" | "fullscreen";
  onBeatCounterModeChange: (mode: "inline" | "fullscreen") => void;
}

const VOICE_TYPES: VoiceType[] = ["human", "cymbal", "clap"];

const VOICE_FILTERS: { value: VoiceFilter; label: string }[] = [
  { value: "mute",      label: "Mute — только музыка" },
  { value: "on1",       label: "On 1 — «One» на первую долю" },
  { value: "on1times3", label: "On 1 × 3 — «One» раз в три" },
  { value: "on1and5",   label: "On 1 & 5 — «One» и «Five»" },
  { value: "full",      label: "Full — счёт 1–8" },
];

const INPUT_CLS =
  "w-14 px-1.5 py-1 rounded bg-gray-700 text-gray-200 text-sm text-center border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function DancerToolbar({ beatCounterMode, onBeatCounterModeChange }: DancerToolbarProps) {
  const voiceType    = usePlayerStore((s) => s.voiceType);
  const voiceFilter  = usePlayerStore((s) => s.voiceFilter);
  const voiceLanguage = usePlayerStore((s) => s.voiceLanguage);
  const duration         = usePlayerStore((s) => s.duration);
  const playUntilSeconds = usePlayerStore((s) => s.playUntilSeconds);
  const loopStartSeconds = usePlayerStore((s) => s.loopStartSeconds);
  const loopPauseSeconds = usePlayerStore((s) => s.loopPauseSeconds);
  const setVoiceType     = usePlayerStore((s) => s.setVoiceType);
  const setVoiceFilter   = usePlayerStore((s) => s.setVoiceFilter);
  const setVoiceLanguage = usePlayerStore((s) => s.setVoiceLanguage);
  const setPlayMode          = usePlayerStore((s) => s.setPlayMode);
  const setPlayUntilSeconds  = usePlayerStore((s) => s.setPlayUntilSeconds);
  const setLoopStartSeconds  = usePlayerStore((s) => s.setLoopStartSeconds);
  const setLoopPauseSeconds  = usePlayerStore((s) => s.setLoopPauseSeconds);

  // Auto-switch to "loop" mode when a loop range is set
  useEffect(() => {
    if (loopStartSeconds != null || playUntilSeconds != null) {
      setPlayMode("loop");
    }
  }, [loopStartSeconds, playUntilSeconds, setPlayMode]);

  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const [loopStartInput, setLoopStartInput] = useState("");
  const [playUntilInput, setPlayUntilInput] = useState("");
  const [loopPauseInput, setLoopPauseInput] = useState("");

  const sliderRef = useRef<HTMLDivElement>(null);
  const draggingLoopRef = useRef<"start" | "end" | null>(null);

  useEffect(() => {
    setLoopStartInput(loopStartSeconds == null ? "" : String(Math.round(loopStartSeconds)));
  }, [loopStartSeconds]);
  useEffect(() => {
    setPlayUntilInput(playUntilSeconds == null ? "" : String(Math.round(playUntilSeconds)));
  }, [playUntilSeconds]);
  useEffect(() => {
    setLoopPauseInput(loopPauseSeconds == null ? "" : String(Math.round(loopPauseSeconds)));
  }, [loopPauseSeconds]);

  // Outside-click for filter menu
  useEffect(() => {
    if (!showFilterMenu) return;
    const handler = (e: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setShowFilterMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showFilterMenu]);

  // Loop slider drag
  const calcLoopTime = useCallback((clientX: number): number => {
    if (!sliderRef.current || duration <= 0) return 0;
    const rect = sliderRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(pct * duration);
  }, [duration]);

  useEffect(() => {
    const onMove = (clientX: number) => {
      const which = draggingLoopRef.current;
      if (!which) return;
      const t = calcLoopTime(clientX);
      if (which === "start") setLoopStartSeconds(t > 0 ? t : null);
      else setPlayUntilSeconds(t > 0 ? t : null);
    };
    const handleMouseMove = (e: MouseEvent) => onMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => { if (e.touches.length > 0) onMove(e.touches[0].clientX); };
    const handleEnd = () => { draggingLoopRef.current = null; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleEnd);
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleEnd);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleEnd);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleEnd);
    };
  }, [calcLoopTime, setLoopStartSeconds, setPlayUntilSeconds]);

  const handleSliderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (draggingLoopRef.current) return;
    const t = calcLoopTime(e.clientX);
    if (loopStartSeconds == null) {
      setLoopStartSeconds(t > 0 ? t : null);
    } else if (playUntilSeconds == null) {
      setPlayUntilSeconds(t > 0 ? t : null);
    } else {
      const distToStart = Math.abs(t - loopStartSeconds);
      const distToEnd = Math.abs(t - (playUntilSeconds));
      if (distToStart <= distToEnd) setLoopStartSeconds(t);
      else setPlayUntilSeconds(t);
    }
  };

  const cycleVoiceType = () => {
    const idx = VOICE_TYPES.indexOf(voiceType);
    setVoiceType(VOICE_TYPES[(idx + 1) % VOICE_TYPES.length]);
  };
  const cycleLang = () => {
    if (voiceType !== "human") return;
    setVoiceLanguage(voiceLanguage === "en" ? "pt" : "en");
  };
  const cycleBeatMode = () => {
    onBeatCounterModeChange(beatCounterMode === "inline" ? "fullscreen" : "inline");
  };

  const voiceTypeLabel = voiceType === "human" ? "Голос" : voiceType === "cymbal" ? "Тарелка" : "Хлопок";
  const beatModeLabel  = beatCounterMode === "inline" ? "Счёт в строке" : "Полный экран";
  const langActive     = voiceType === "human";
  const langLabel      = voiceLanguage === "en" ? "Англ." : "Порт.";

  // Loop marker positions — always show handles (0% and 100% as defaults)
  const displayStartPct = loopStartSeconds != null && loopStartSeconds > 0 && duration > 0
    ? Math.min(100, (loopStartSeconds / duration) * 100) : 0;
  const displayEndPct = playUntilSeconds != null && playUntilSeconds > 0 && duration > 0
    ? Math.min(100, (playUntilSeconds / duration) * 100) : 100;

  const btnBox = "w-16 h-16 rounded-2xl bg-gray-700 group-hover:bg-gray-600 transition-colors flex items-center justify-center text-purple-400 group-hover:text-purple-300";
  const iconCls = "w-9 h-9";

  const loopActive = loopStartSeconds != null || playUntilSeconds != null;

  return (
    <div className="border-t border-gray-700/50 px-6 py-6">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex-1" />
        <p className="text-xl text-gray-400">Инструментарий танцора</p>
        <div className="flex-1 flex justify-end">
          <button
            onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 text-gray-600 hover:text-gray-400 transition-colors"
          >
            <span className="text-sm">Инструкция</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8a2 2 0 012 2c0 1.5-2 2-2 3.5M12 17h.01"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── Icon buttons row (centered) ──────────────────────────── */}
      <div className="flex items-start justify-center gap-5">

        {/* Voice type cycling */}
        <button onClick={cycleVoiceType} title={`Тип: ${voiceTypeLabel}`} className="flex flex-col items-center gap-2 group">
          <div className={btnBox}>
            {voiceType === "human" && (
              /* Speaking person silhouette */
              <svg className={iconCls} viewBox="0 0 24 24" fill="currentColor">
                <circle cx="8" cy="6" r="3.5"/>
                <path d="M2 19.5c0-3.6 2.7-6.5 6-6.5 1.4 0 2.7.5 3.7 1.4"/>
                <path d="M15 10.5a3 3 0 000-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                <path d="M17.5 12.5a6 6 0 000-9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
              </svg>
            )}
            {voiceType === "cymbal" && (
              <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <ellipse cx="12" cy="11" rx="9" ry="4"/>
                <circle cx="12" cy="11" r="1.5" fill="currentColor" stroke="none"/>
                <line x1="12" y1="15" x2="12" y2="21" strokeLinecap="round"/>
              </svg>
            )}
            {voiceType === "clap" && (
              <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 4.5L10 3a1.5 1.5 0 012.1 0l.9.9M10 3L7 6m7.5-1.5L16 3a1.5 1.5 0 012.1 0l.4.4M7 6L4.5 8.5a3 3 0 000 4.2l5.3 5.3A5 5 0 0016.9 20l.6-.6a3 3 0 000-4.2L14 11.5M7 6l3 3"/>
              </svg>
            )}
          </div>
          <span className="w-16 text-center text-base text-gray-500 group-hover:text-gray-300 transition-colors leading-tight">{voiceTypeLabel}</span>
        </button>

        {/* Language toggle */}
        <button onClick={cycleLang} disabled={!langActive}
          title={langActive ? `Язык: ${langLabel}` : "Недоступно"}
          className="flex flex-col items-center gap-2 group"
        >
          <div className={`w-16 h-16 rounded-2xl transition-colors flex items-center justify-center ${
            langActive ? "bg-gray-700 group-hover:bg-gray-600 text-purple-400 group-hover:text-purple-300" : "bg-gray-700/40 text-gray-600 cursor-not-allowed"
          }`}>
            <svg className={iconCls} viewBox="0 0 24 24" fill="currentColor">
              <text x="1.5" y="10" fontSize="12" fontFamily="sans-serif" stroke="none">文</text>
              <text x="12" y="18" fontSize="13" fontFamily="sans-serif" fontWeight="600" stroke="none">A</text>
            </svg>
          </div>
          <span className={`w-16 text-center text-base transition-colors leading-tight ${langActive ? "text-gray-500 group-hover:text-gray-300" : "text-gray-600"}`}>
            {langActive ? langLabel : "Язык"}
          </span>
        </button>

        {/* Beat counter mode cycling */}
        <button onClick={cycleBeatMode} title={beatModeLabel} className="flex flex-col items-center gap-2 group">
          <div className={btnBox}>
            {beatCounterMode === "inline" ? (
              /* 2×2 open grid: 1 2 / 3 4 */
              <svg className={iconCls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.0}>
                <line x1="12" y1="1" x2="12" y2="23"/>
                <line x1="1" y1="12" x2="23" y2="12"/>
                <text x="6" y="6" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none" textAnchor="middle" dominantBaseline="central">1</text>
                <text x="18" y="6" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none" textAnchor="middle" dominantBaseline="central">2</text>
                <text x="6" y="18" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none" textAnchor="middle" dominantBaseline="central">3</text>
                <text x="18" y="18" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none" textAnchor="middle" dominantBaseline="central">4</text>
              </svg>
            ) : (
              <svg className={iconCls} fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
              </svg>
            )}
          </div>
          <span className="w-24 text-center text-base text-gray-500 group-hover:text-gray-300 transition-colors leading-tight">{beatModeLabel}</span>
        </button>

        {/* Voice filter dropdown */}
        <div ref={filterMenuRef} className="relative flex flex-col items-center gap-2">
          <button onClick={() => setShowFilterMenu(!showFilterMenu)} title="Режим счёта" className="flex flex-col items-center gap-2 group">
            <div className={`w-16 h-16 rounded-2xl transition-colors flex items-center justify-center ${
              showFilterMenu ? "bg-gray-600 text-purple-300" : "bg-gray-700 group-hover:bg-gray-600 text-purple-400 group-hover:text-purple-300"
            }`}>
              <svg className={iconCls} viewBox="0 0 24 24" fill="currentColor">
                <rect x="2"  y="8"  width="3" height="6" rx="1"/>
                <rect x="7"  y="5"  width="3" height="11" rx="1"/>
                <rect x="12" y="9"  width="3" height="5" rx="1"/>
                <rect x="17" y="4"  width="3" height="9" rx="1" opacity="0.65"/>
                <text x="1" y="23" fontSize="5.5" fontFamily="monospace" fill="currentColor" letterSpacing="1.8">1  2  3  4</text>
              </svg>
            </div>
            <span className={`w-16 text-center text-base transition-colors leading-tight ${showFilterMenu ? "text-gray-300" : "text-gray-500 group-hover:text-gray-300"}`}>Счёт</span>
          </button>

          {showFilterMenu && (
            <div className="absolute bottom-full mb-3 right-0 bg-gray-800 border border-gray-600 rounded-2xl shadow-2xl py-2 z-50" style={{ minWidth: "230px" }}>
              <div className="px-1 flex flex-col gap-1">
                {VOICE_FILTERS.map((f) => (
                  <button key={f.value}
                    onClick={() => { setVoiceFilter(f.value); setShowFilterMenu(false); }}
                    className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 ${
                      voiceFilter === f.value ? "bg-purple-600/20 text-white" : "text-gray-300 hover:bg-gray-700 hover:text-white"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${voiceFilter === f.value ? "bg-purple-400" : "bg-transparent"}`} />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Loop / Cycle section ─────────────────────────────────── */}
      <div className="mt-6 pt-4 border-t border-gray-700/50">
        <p className="text-center text-xl mb-6 text-gray-400">Цикл</p>

        {/* Row: [start input] [slider] [end input] */}
        <div className="flex items-center gap-8 mb-2">
          {/* Start input */}
          <input type="number" min={0} max={999} step={1} placeholder="сек"
            value={loopStartInput}
            onChange={(e) => setLoopStartInput(e.target.value)}
            onBlur={() => {
              const v = loopStartInput.trim();
              if (!v) { setLoopStartSeconds(null); return; }
              const s = parseInt(v, 10);
              if (Number.isFinite(s) && s >= 0) { setLoopStartSeconds(s); setLoopStartInput(String(s)); }
              else { setLoopStartSeconds(null); setLoopStartInput(""); }
            }}
            className={`${INPUT_CLS} shrink-0`} aria-label="Начало цикла (сек)"
          />

          {/* Visual range slider */}
          <div
            ref={sliderRef}
            onClick={handleSliderClick}
            className="relative flex-1 h-8 cursor-pointer select-none"
          >
            {/* Track background */}
            <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-2 bg-gray-600 rounded-full" />

            {/* Highlighted zone — always between start and end */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-2 bg-yellow-500/40 rounded-full"
              style={{ left: `${displayStartPct}%`, width: `${displayEndPct - displayStartPct}%` }}
            />

            {/* Start handle — always visible */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-yellow-400 rounded-full cursor-grab active:cursor-grabbing shadow-md border-2 border-yellow-300 z-10 touch-none"
              style={{ left: `${displayStartPct}%` }}
              title={loopStartSeconds != null ? `Начало: ${fmt(loopStartSeconds)}` : "Начало"}
              onMouseDown={(e) => { e.stopPropagation(); draggingLoopRef.current = "start"; }}
              onTouchStart={(e) => { e.stopPropagation(); draggingLoopRef.current = "start"; }}
            />

            {/* End handle — always visible */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 bg-yellow-400 rounded-full cursor-grab active:cursor-grabbing shadow-md border-2 border-yellow-300 z-10 touch-none"
              style={{ left: `${displayEndPct}%` }}
              title={playUntilSeconds != null ? `Конец: ${fmt(playUntilSeconds)}` : "Конец"}
              onMouseDown={(e) => { e.stopPropagation(); draggingLoopRef.current = "end"; }}
              onTouchStart={(e) => { e.stopPropagation(); draggingLoopRef.current = "end"; }}
            />

            {/* Time labels */}
            <div className="absolute -bottom-5 left-0 text-[10px] text-gray-500">0:00</div>
            {duration > 0 && (
              <div className="absolute -bottom-5 right-0 text-[10px] text-gray-500">{fmt(duration)}</div>
            )}
          </div>

          {/* End input */}
          <input type="number" min={1} max={999} step={1} placeholder="сек"
            value={playUntilInput}
            onChange={(e) => setPlayUntilInput(e.target.value)}
            onBlur={() => {
              const v = playUntilInput.trim();
              if (!v) { setPlayUntilSeconds(null); return; }
              const s = parseInt(v, 10);
              if (Number.isFinite(s) && s > 0) { setPlayUntilSeconds(s); setPlayUntilInput(String(s)); }
              else { setPlayUntilSeconds(null); setPlayUntilInput(""); }
            }}
            className={`${INPUT_CLS} shrink-0`} aria-label="Конец цикла (сек)"
          />
        </div>

        {/* Row: Interval left, Reset right */}
        <div className="flex items-center justify-between gap-2 mt-7 mb-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500 shrink-0">Интервал</span>
            <input type="number" min={0} max={999} step={1} placeholder="сек"
              value={loopPauseInput}
              onChange={(e) => setLoopPauseInput(e.target.value)}
              onBlur={() => {
                const v = loopPauseInput.trim();
                if (!v) { setLoopPauseSeconds(null); return; }
                const s = parseInt(v, 10);
                if (Number.isFinite(s) && s >= 0) { setLoopPauseSeconds(s); setLoopPauseInput(String(s)); }
                else { setLoopPauseSeconds(null); setLoopPauseInput(""); }
              }}
              className={INPUT_CLS} aria-label="Пауза между циклами (сек)"
            />
            <span className="text-xs text-gray-500 shrink-0">сек</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoopStartSeconds(null); setLoopStartInput("");
              setPlayUntilSeconds(null); setPlayUntilInput("");
              setLoopPauseSeconds(null); setLoopPauseInput("");
            }}
            className={`px-2 py-1 text-sm rounded text-gray-300 hover:text-white transition-colors ${
              loopActive ? "bg-red-600 hover:bg-red-500" : "bg-gray-700 hover:bg-gray-600"
            }`}
          >
            Сбросить
          </button>
        </div>

        <p className="text-xs text-gray-500 leading-relaxed">
          Выставьте нужный отрезок, и он будет играть бесконечно — удобно для заучивания хореографии и футворков.
          Можно задать паузу между повторами.
        </p>
      </div>

      {/* ── Help modal ─────────────────────────────────────────────── */}
      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-gray-800 border border-gray-700 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-white">Инструкция</h3>
              <button onClick={() => setShowHelp(false)} className="text-gray-500 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="space-y-4 text-sm">
              {/* Voice type */}
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-purple-400">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="8" cy="6" r="3.5"/>
                    <path d="M2 19.5c0-3.6 2.7-6.5 6-6.5 1.4 0 2.7.5 3.7 1.4"/>
                    <path d="M15 10.5a3 3 0 000-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                    <path d="M17.5 12.5a6 6 0 000-9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium mb-0.5">Голос / Тарелка / Хлопок</p>
                  <p className="text-gray-500 text-xs leading-relaxed">Тип звукового сигнала для счёта. Голос озвучивает цифрами, тарелка и хлопок дают ударный акцент.</p>
                </div>
              </div>

              {/* Language */}
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-purple-400">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <text x="1.5" y="14" fontSize="12" fontFamily="sans-serif" stroke="none">文</text>
                    <text x="12" y="22" fontSize="13" fontFamily="sans-serif" fontWeight="600" stroke="none">A</text>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium mb-0.5">Англ. / Порт. — Язык</p>
                  <p className="text-gray-500 text-xs leading-relaxed">Язык озвучки (английский или португальский). Доступно только в режиме «Голос».</p>
                </div>
              </div>

              {/* Beat mode */}
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-purple-400">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.0}>
                    <line x1="12" y1="1" x2="12" y2="23"/>
                    <line x1="1" y1="12" x2="23" y2="12"/>
                    <text x="4" y="10.5" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none">1</text>
                    <text x="14" y="10.5" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none">2</text>
                    <text x="4" y="21" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none">3</text>
                    <text x="14" y="21" fontSize="7" fontFamily="monospace" fill="currentColor" stroke="none">4</text>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium mb-0.5">Счёт в строке / Полный экран</p>
                  <p className="text-gray-500 text-xs leading-relaxed">Переключает отображение счётчика: компактный встроенный вид или на весь экран.</p>
                </div>
              </div>

              {/* Voice filter */}
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-purple-400">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="2"  y="8"  width="3" height="6" rx="1"/>
                    <rect x="7"  y="5"  width="3" height="11" rx="1"/>
                    <rect x="12" y="9"  width="3" height="5" rx="1"/>
                    <rect x="17" y="4"  width="3" height="9" rx="1" opacity="0.65"/>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium mb-0.5">Счёт (режим)</p>
                  <p className="text-gray-500 text-xs leading-relaxed">Mute (тишина), On 1 (первая доля), On 1×3, On 1&5 или Full (счёт 1–8).</p>
                </div>
              </div>

              {/* Loop */}
              <div className="flex gap-3">
                <div className="shrink-0 w-8 h-8 rounded-xl bg-gray-700 flex items-center justify-center text-purple-400">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3"/>
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium mb-0.5">Цикл</p>
                  <p className="text-gray-500 text-xs leading-relaxed">Задайте начало и конец фрагмента — он будет повторяться бесконечно. Удобно для отработки связок. Можно добавить паузу между повторами.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
