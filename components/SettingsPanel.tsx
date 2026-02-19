"use client";

import { useState } from "react";
import { usePlayerStore } from "@/store/playerStore";
import type { PlayMode, VoiceFilter, VoiceLanguage } from "@/types";

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
    setPlayMode,
    setVoiceFilter,
    setVoiceLanguage,
  } = usePlayerStore();
  const [isPlayModeExpanded, setIsPlayModeExpanded] = useState(false);
  const [isVoiceFilterExpanded, setIsVoiceFilterExpanded] = useState(false);

  const playModes: { value: PlayMode; label: string }[] = [
    { value: "sequential", label: "Sequential (По порядку)" },
    { value: "random", label: "Random (Случайно)" },
    { value: "loop", label: "Loop (Один трек)" },
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
                  checked={playMode === mode.value}
                  onChange={() => setPlayMode(mode.value)}
                  className="mr-2 w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer"
                />
                <span className="text-sm text-gray-300">{mode.label}</span>
              </label>
            ))}
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
            {/* Language selector */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-gray-400">Язык:</span>
              <div className="flex gap-1">
                {voiceLanguages.map((lang) => (
                  <button
                    key={lang.value}
                    onClick={() => setVoiceLanguage(lang.value)}
                    className={`px-3 py-1 text-xs rounded-md transition-colors ${
                      voiceLanguage === lang.value
                        ? "bg-purple-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white"
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

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
                    checked={voiceFilter === filter.value}
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
