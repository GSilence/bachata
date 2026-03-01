"use client";

import { useState, useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";
import type { PlayMode, VoiceFilter, VoiceLanguage, VoiceType } from "@/types";

interface SettingsPanelProps {
  showOnlyVoiceFilter?: boolean;
  showOnlyPlayMode?: boolean;
}

export default function SettingsPanel({
  showOnlyVoiceFilter,
  showOnlyPlayMode,
}: SettingsPanelProps = {}) {
  const {
    playMode,
    voiceFilter,
    voiceLanguage,
    voiceType,
    playUntilSeconds,
    setPlayMode,
    setVoiceFilter,
    setVoiceLanguage,
    setVoiceType,
    setPlayUntilSeconds,
  } = usePlayerStore();
  const [mounted, setMounted] = useState(false);
  const [isPlayModeExpanded, setIsPlayModeExpanded] = useState(false);
  const [isVoiceFilterExpanded, setIsVoiceFilterExpanded] = useState(false);
  const [playUntilInput, setPlayUntilInput] = useState("");

  useEffect(() => { setMounted(true); }, []);

  // SSR-безопасные значения: до mount используем дефолты, чтобы SSR и клиент совпадали
  const activeVoiceType: VoiceType     = mounted ? voiceType     : "human";
  const activeVoiceLanguage: VoiceLanguage = mounted ? voiceLanguage : "en";
  const activeVoiceFilter: VoiceFilter = mounted ? voiceFilter   : "full";
  const activePlayMode: PlayMode       = mounted ? playMode      : "sequential";

  // Синхронизируем поле "воспроизводить до" с store (при загрузке из persist)
  useEffect(() => {
    if (playUntilSeconds == null) {
      setPlayUntilInput("");
    } else {
      setPlayUntilInput(String(Math.round(playUntilSeconds)));
    }
  }, [playUntilSeconds]);

  const playModes: { value: PlayMode; label: string }[] = [
    { value: "sequential", label: "Sequential (По порядку)" },
    { value: "random", label: "Random (Случайно)" },
    { value: "loop", label: "Loop (Один трек)" },
  ];

  const voiceTypes: { value: VoiceType; label: string; title: string }[] = [
    { value: "human", label: "Голос", title: "Человеческий голос" },
    { value: "cymbal", label: "Тарелка", title: "Удар тарелкой" },
    { value: "clap", label: "Хлопок", title: "Хлопок ладошками" },
  ];

  const voiceLanguages: { value: VoiceLanguage; label: string }[] = [
    { value: "en", label: "English" },
    { value: "pt", label: "Português" },
  ];

  const voiceFilters: { value: VoiceFilter; label: string }[] = [
    { value: "mute", label: "Mute (Только музыка)" },
    { value: "on1", label: 'On 1 (Голос говорит "One" на первую долю)' },
    {
      value: "on1times3",
      label: 'On 1 × 3 (Голос говорит "One" только каждый третий РАЗ)',
    },
    { value: "on1and5", label: 'On 1 & 5 (Голос говорит "One" и "Five")' },
    { value: "full", label: "Full (Счет 1-8)" },
  ];

  return (
    <div className="space-y-6" data-component="settings-panel">
      {!showOnlyVoiceFilter && !showOnlyPlayMode && (
        <h2 className="text-xl font-semibold mb-4 text-white">Настройки</h2>
      )}

      {/* Mode Selection */}
      {(!showOnlyVoiceFilter || showOnlyPlayMode) && (
        <div data-setting="play-mode">
          <button
            onClick={() => setIsPlayModeExpanded(!isPlayModeExpanded)}
            className="lg:hidden w-full flex items-center justify-between text-sm font-medium text-gray-400 mb-0 lg:mb-2 hover:text-white transition-colors"
          >
            <span>Mode (Режим воспроизведения)</span>
            <span className="text-lg">{isPlayModeExpanded ? "−" : "+"}</span>
          </button>
          <label className="hidden lg:block text-sm font-medium text-gray-400 mb-4">
            Mode (Режим воспроизведения)
          </label>
          <div
            className={`space-y-2 pt-4 pb-2 lg:pt-0 lg:pb-0 ${
              !isPlayModeExpanded ? "hidden lg:block" : ""
            }`}
          >
            {playModes.map((mode) => (
              <label
                key={mode.value}
                className="flex items-center cursor-pointer hover:text-white"
                data-option={mode.value}
              >
                <input
                  type="radio"
                  name="playMode"
                  value={mode.value}
                  checked={activePlayMode === mode.value}
                  onChange={() => setPlayMode(mode.value)}
                  className="mr-2 w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer"
                />
                <span className="text-sm text-gray-300">{mode.label}</span>
              </label>
            ))}
          </div>

          {/* Воспроизводить до (ограничение по времени) */}
          <div className="pt-3 border-t border-gray-700/70 mt-3">
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Воспроизводить до
            </label>
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="number"
                min={1}
                step={1}
                placeholder="сек"
                value={playUntilInput}
                onChange={(e) => setPlayUntilInput(e.target.value)}
                onBlur={() => {
                  const trimmed = playUntilInput.trim();
                  if (!trimmed) {
                    setPlayUntilSeconds(null);
                    return;
                  }
                  const sec = parseInt(trimmed, 10);
                  if (Number.isFinite(sec) && sec > 0) {
                    setPlayUntilSeconds(sec);
                    setPlayUntilInput(String(sec));
                  } else {
                    setPlayUntilSeconds(null);
                    setPlayUntilInput("");
                  }
                }}
                className="w-24 px-2 py-1.5 rounded bg-gray-700 text-gray-200 text-sm border border-gray-600 focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                aria-label="Секунды"
              />
              <span className="text-sm text-gray-500">сек</span>
              <button
                type="button"
                onClick={() => {
                  setPlayUntilSeconds(null);
                  setPlayUntilInput("");
                }}
                className="px-2 py-1.5 text-xs rounded bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white transition-colors"
              >
                Сбросить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Filter Selection */}
      {(!showOnlyPlayMode || showOnlyVoiceFilter) && (
        <div data-setting="voice-filter">
          <button
            onClick={() => setIsVoiceFilterExpanded(!isVoiceFilterExpanded)}
            className="lg:hidden w-full flex items-center justify-between text-sm font-medium text-gray-400 mb-0 lg:mb-2 hover:text-white transition-colors"
          >
            <span>Voice Filter (Режим озвучки)</span>
            <span className="text-lg">{isVoiceFilterExpanded ? "−" : "+"}</span>
          </button>
          <label className="hidden lg:block text-sm font-medium text-gray-400 mb-4">
            Voice Filter (Режим озвучки)
          </label>
          <div
            className={`pt-4 pb-2 lg:pt-0 lg:pb-0 ${
              !isVoiceFilterExpanded ? "hidden lg:block" : ""
            }`}
          >
            {/* Тип озвучки */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-gray-400 shrink-0">Тип:</span>
              <div className="flex gap-1">
                {voiceTypes.map((vt) => (
                  <button
                    key={vt.value}
                    onClick={() => setVoiceType(vt.value)}
                    title={vt.title}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      activeVoiceType === vt.value
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                    }`}
                  >
                    {vt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Language selector — только для человеческого голоса */}
            {activeVoiceType === "human" && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-sm text-gray-400">Язык:</span>
                <div className="flex gap-1">
                  {voiceLanguages.map((lang) => (
                    <button
                      key={lang.value}
                      onClick={() => setVoiceLanguage(lang.value)}
                      className={`px-3 py-1 text-xs rounded-md transition-colors ${
                        activeVoiceLanguage === lang.value
                          ? "bg-purple-600 text-white"
                          : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                      }`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Filter options */}
            <div className="space-y-2">
              {voiceFilters.map((filter) => (
                <label
                  key={filter.value}
                  className="flex items-center cursor-pointer hover:text-white"
                  data-option={filter.value}
                >
                  <input
                    type="radio"
                    name="voiceFilter"
                    value={filter.value}
                    checked={activeVoiceFilter === filter.value}
                    onChange={() => setVoiceFilter(filter.value)}
                    className="mr-2 w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer"
                  />
                  <span className="text-sm text-gray-300">{filter.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
