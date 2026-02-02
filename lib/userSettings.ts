/**
 * Управление настройками пользователя в localStorage
 * Сохраняет и восстанавливает настройки громкости, режима воспроизведения и озвучки
 */

import type { PlayMode, VoiceFilter, VoiceLanguage } from "@/types";

export interface UserSettings {
  musicVolume: number;
  voiceVolume: number;
  playMode: PlayMode;
  voiceFilter: VoiceFilter;
  voiceLanguage: VoiceLanguage;
}

const SETTINGS_KEY = "bachata-user-settings";

/**
 * Получить настройки пользователя из localStorage
 */
export function getUserSettings(): UserSettings | null {
  if (typeof window === "undefined") return null;

  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return null;

    const parsed = JSON.parse(stored) as UserSettings;

    // Валидация данных
    if (
      typeof parsed.musicVolume === "number" &&
      typeof parsed.voiceVolume === "number" &&
      typeof parsed.playMode === "string" &&
      typeof parsed.voiceFilter === "string" &&
      parsed.musicVolume >= 0 &&
      parsed.musicVolume <= 100 &&
      parsed.voiceVolume >= 0 &&
      parsed.voiceVolume <= 100
    ) {
      // Добавляем значения по умолчанию для новых полей (миграция старых настроек)
      if (!parsed.voiceLanguage) {
        parsed.voiceLanguage = "en";
      }
      return parsed;
    }
  } catch (error) {
    console.warn("Failed to parse user settings from localStorage:", error);
    // Очищаем поврежденные данные
    try {
      localStorage.removeItem(SETTINGS_KEY);
    } catch (clearError) {
      console.error("Failed to clear corrupted localStorage:", clearError);
    }
  }

  return null;
}

/**
 * Сохранить настройки пользователя в localStorage
 */
export function saveUserSettings(settings: Partial<UserSettings>): void {
  if (typeof window === "undefined") return;

  try {
    // Получаем текущие настройки
    const current = getUserSettings() || getDefaultSettings();

    // Объединяем с новыми настройками
    const updated: UserSettings = {
      ...current,
      ...settings,
    };

    // Валидация перед сохранением
    if (
      updated.musicVolume >= 0 &&
      updated.musicVolume <= 100 &&
      updated.voiceVolume >= 0 &&
      updated.voiceVolume <= 100
    ) {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    } else {
      console.warn("Invalid settings values, not saving:", updated);
    }
  } catch (error) {
    console.error("Failed to save user settings to localStorage:", error);
  }
}

/**
 * Получить настройки по умолчанию
 */
export function getDefaultSettings(): UserSettings {
  return {
    musicVolume: 100,
    voiceVolume: 100,
    playMode: "sequential",
    voiceFilter: "full",
    voiceLanguage: "en",
  };
}

/**
 * Очистить настройки пользователя
 */
export function clearUserSettings(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch (error) {
    console.error("Failed to clear user settings from localStorage:", error);
  }
}

/**
 * Восстановить настройки пользователя при загрузке страницы
 * Возвращает настройки из localStorage или значения по умолчанию
 */
export function restoreUserSettings(): UserSettings {
  const stored = getUserSettings();
  return stored || getDefaultSettings();
}
