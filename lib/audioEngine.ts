import { Howl, Howler } from "howler";
import type { Track, GridMap } from "@/types";

export class AudioEngine {
  // Singleton instance
  private static instance: AudioEngine | null = null;

  // Основной трек (цельный файл)
  private musicTrack: Howl | null = null;

  // Stems (4 дорожки для обработанных треков)
  private stemsTracks: {
    vocals: Howl | null;
    drums: Howl | null;
    bass: Howl | null;
    other: Howl | null;
  } = {
    vocals: null,
    drums: null,
    bass: null,
    other: null,
  };

  // Текущий трек (сохраняется для возможного использования в будущем: отладка, метаданные и т.д.)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private currentTrack: Track | null = null;

  // Настройки
  private musicVolume: number = 100;

  // Stems настройки
  private isStemsMode: boolean = false; // По умолчанию цельный файл
  private stemsEnabled: {
    vocals: boolean;
    drums: boolean;
    bass: boolean;
    other: boolean;
  } = {
    vocals: true,
    drums: true,
    bass: true,
    other: true,
  };
  private stemsVolume: {
    vocals: number;
    drums: number;
    bass: number;
    other: number;
  } = {
    vocals: 100,
    drums: 100,
    bass: 100,
    other: 100,
  };

  // Callbacks
  private onTrackEnd: (() => void) | null = null;
  private trackEndFired: boolean = false;

  // Beat tracking (cursor-based approach)
  private beatMap: number[] = []; // Array of beat timestamps in seconds
  private currentBeatIndex: number = 0;
  private updateAnimationFrameId: number | null = null;

  private constructor() {
    // Private constructor to enforce Singleton pattern
  }

  /**
   * Get the singleton instance of AudioEngine
   */
  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  /**
   * Загружает трек в плеер
   * Важно: полностью выгружает старый трек перед созданием нового
   * CRITICAL: Calls stop() and unloadTrack() FIRST to simulate user pressing Stop button
   *
   * @param track - Трек для загрузки
   * @param isStemsMode - Использовать ли стемы (4 дорожки) или цельный файл
   * @param stemsEnabled - Какие стемы включены
   * @param stemsVolume - Громкость каждого стема
   */
  loadTrack(
    track: Track,
    isStemsMode?: boolean,
    stemsEnabled?: {
      vocals: boolean;
      drums: boolean;
      bass: boolean;
      other: boolean;
    },
    stemsVolume?: { vocals: number; drums: number; bass: number; other: number }
  ) {
    // Early return if track path is missing
    if (!track.pathOriginal) {
      console.warn("Cannot load track: pathOriginal is missing");
      return; // Трек без пути не может быть загружен
    }

    // CRITICAL STEP 1: Stop playback (simulates user pressing Stop button)
    this.stop();

    // CRITICAL STEP 2: Unload track (includes Howler.unload() to kill all zombies)
    this.unloadTrack();

    // STEP 3: Update stems settings if provided
    if (isStemsMode !== undefined) {
      this.isStemsMode = isStemsMode;
    }
    if (stemsEnabled) {
      this.stemsEnabled = { ...this.stemsEnabled, ...stemsEnabled };
    }
    if (stemsVolume) {
      this.stemsVolume = { ...this.stemsVolume, ...stemsVolume };
    }

    // STEP 4: Reset state for new track
    this.currentTrack = track;
    this.trackEndFired = false;
    this.currentBeatIndex = 0;

    // STEP 5: Build beatMap from gridMap if available
    this.buildBeatMap(track);

    // STEP 6: Load track based on mode
    if (this.isStemsMode && track.isProcessed) {
      // Stems Mode: загружаем 4 дорожки
      this.loadStems(track);
    } else {
      // Full File Mode: загружаем цельный файл
      this.loadFullFile(track);
    }
  }

  /**
   * Загружает цельный файл
   */
  private loadFullFile(track: Track) {
    if (!track.pathOriginal) {
      console.warn("Cannot load full file: pathOriginal is missing");
      return;
    }

    // CRITICAL: Only create after all cleanup is complete
    this.musicTrack = new Howl({
      src: [track.pathOriginal],
      html5: true,
      preload: true,
      volume: this.musicVolume / 100,
      onload: () => {
        // Safe callback - track is loaded
      },
      onend: () => {
        if (this.onTrackEnd && !this.trackEndFired) {
          this.trackEndFired = true;
          this.onTrackEnd();
        }
      },
      onplay: () => {
        // Safe callback - track started playing
      },
      onloaderror: (id, error) => {
        console.error("Howl load error:", error);
      },
    });
  }

  /**
   * Загружает стемы (4 дорожки)
   */
  private loadStems(track: Track) {
    if (
      !track.pathVocals ||
      !track.pathDrums ||
      !track.pathBass ||
      !track.pathOther
    ) {
      console.warn(
        "Cannot load stems: some stem paths are missing, falling back to full file"
      );
      this.loadFullFile(track);
      return;
    }

    // Создаём 4 Howl инстанса для стемов
    const createStem = (
      src: string,
      volume: number,
      enabled: boolean
    ): Howl => {
      return new Howl({
        src: [src],
        html5: true,
        preload: true,
        volume: (this.musicVolume / 100) * (volume / 100) * (enabled ? 1 : 0),
        onloaderror: (id, error) => {
          console.error(`Howl load error for stem ${src}:`, error);
        },
      });
    };

    // TypeScript теперь знает, что пути не null благодаря проверке выше
    this.stemsTracks.vocals = createStem(
      track.pathVocals!,
      this.stemsVolume.vocals,
      this.stemsEnabled.vocals
    );
    this.stemsTracks.drums = createStem(
      track.pathDrums!,
      this.stemsVolume.drums,
      this.stemsEnabled.drums
    );
    this.stemsTracks.bass = createStem(
      track.pathBass!,
      this.stemsVolume.bass,
      this.stemsEnabled.bass
    );
    this.stemsTracks.other = createStem(
      track.pathOther!,
      this.stemsVolume.other,
      this.stemsEnabled.other
    );

    // Устанавливаем onend callback на все стемы (используем vocals как основной)
    if (this.stemsTracks.vocals) {
      this.stemsTracks.vocals.on("end", () => {
        if (this.onTrackEnd && !this.trackEndFired) {
          this.trackEndFired = true;
          this.onTrackEnd();
        }
      });
    }
  }

  /**
   * Строит beatMap из gridMap трека (cursor-based approach)
   * Если gridMap отсутствует, создает простую карту на основе BPM
   */
  private buildBeatMap(track: Track) {
    this.beatMap = [];

    if (track.gridMap && track.gridMap.grid) {
      // Используем gridMap для точной карты битов
      for (const section of track.gridMap.grid) {
        const beatsPerSecond = (track.gridMap.bpm / 60) * 4; // 4 beats per measure
        const beatInterval = 1 / beatsPerSecond;

        for (let i = 0; i < section.beats; i++) {
          const beatTime = section.start + i * beatInterval;
          this.beatMap.push(beatTime);
        }
      }
    } else {
      // Fallback: создаем простую карту на основе BPM и offset
      const bpm = track.bpm || 120;
      const offset = track.offset || 0;
      const beatsPerSecond = (bpm / 60) * 4; // 4 beats per measure
      const beatInterval = 1 / beatsPerSecond;

      // Создаем биты на основе длительности трека (будет обновлено после загрузки)
      const estimatedDuration = 180; // 3 минуты по умолчанию
      const totalBeats = Math.ceil(estimatedDuration * beatsPerSecond);

      for (let i = 0; i < totalBeats; i++) {
        this.beatMap.push(offset + i * beatInterval);
      }
    }
  }

  /**
   * Выгружает текущий трек
   * Важно: полностью останавливает и очищает все ресурсы
   * Критически важно для предотвращения исчерпания пула HTML5 Audio
   * CRITICAL: Calls Howler.unload() to kill ALL zombie instances
   */
  unloadTrack() {
    // Останавливаем update loop
    this.stopUpdate();

    // Выгружаем цельный файл
    if (this.musicTrack) {
      const oldTrack = this.musicTrack;
      this.musicTrack = null;

      try {
        if (oldTrack.playing && oldTrack.playing()) {
          oldTrack.stop();
        }
        oldTrack.seek(0);
        oldTrack.off();
        oldTrack.unload();
      } catch (e) {
        // Игнорируем ошибки
      }
    }

    // Выгружаем стемы
    const stemKeys: Array<keyof typeof this.stemsTracks> = [
      "vocals",
      "drums",
      "bass",
      "other",
    ];
    for (const key of stemKeys) {
      if (this.stemsTracks[key]) {
        const oldStem = this.stemsTracks[key];
        this.stemsTracks[key] = null;

        try {
          if (oldStem && oldStem.playing && oldStem.playing()) {
            oldStem.stop();
          }
          if (oldStem) {
            oldStem.seek(0);
            oldStem.off();
            oldStem.unload();
          }
        } catch (e) {
          // Игнорируем ошибки
        }
      }
    }

    // CRITICAL: Global unload to kill ALL zombie instances
    try {
      Howler.unload();
    } catch (e) {
      console.warn("Error calling Howler.unload() in unloadTrack:", e);
    }

    // Очищаем состояние
    this.currentTrack = null;
    this.trackEndFired = false;
    this.beatMap = [];
    this.currentBeatIndex = 0;
  }

  /**
   * Воспроизведение - продолжает с текущей позиции
   */
  play() {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Воспроизводим стемы
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key] && this.stemsEnabled[key]) {
          try {
            this.stemsTracks[key]?.play();
          } catch (e) {
            console.warn(`Error playing stem ${key}:`, e);
          }
        }
      }
    } else if (this.musicTrack) {
      // Воспроизводим цельный файл
      this.musicTrack.play();
    }
    this.startUpdate();
  }

  /**
   * Пауза - останавливает, но сохраняет позицию
   */
  pause() {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Пауза стемов
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          try {
            this.stemsTracks[key]?.pause();
          } catch (e) {
            console.warn(`Error pausing stem ${key}:`, e);
          }
        }
      }
    } else if (this.musicTrack) {
      // Пауза цельного файла
      this.musicTrack.pause();
    }
    this.stopUpdate();
  }

  /**
   * Стоп - останавливает и сбрасывает в начало
   * Also resets currentBeatIndex to 0
   */
  stop() {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Стоп стемов
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          try {
            this.stemsTracks[key]?.stop();
            this.stemsTracks[key]?.seek(0);
          } catch (e) {
            console.warn(`Error stopping stem ${key}:`, e);
          }
        }
      }
    } else if (this.musicTrack) {
      // Стоп цельного файла
      try {
        this.musicTrack.stop();
        this.musicTrack.seek(0);
      } catch (e) {
        console.warn("Error stopping track:", e);
      }
    }
    this.trackEndFired = false;
    this.currentBeatIndex = 0; // Reset beat index
    this.stopUpdate();
  }

  /**
   * Проверяет, играет ли трек
   */
  isPlaying(): boolean {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Проверяем хотя бы один активный стем
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key] && this.stemsEnabled[key]) {
          if (this.stemsTracks[key]?.playing()) {
            return true;
          }
        }
      }
      return false;
    } else if (this.musicTrack) {
      return this.musicTrack.playing();
    }
    return false;
  }

  /**
   * Получает текущее время воспроизведения
   * Просто возвращает время из Howler - это легкая операция
   */
  getCurrentTime(): number {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Используем vocals как основной источник времени (все стемы синхронизированы)
      if (this.stemsTracks.vocals) {
        return this.stemsTracks.vocals.seek() as number;
      }
      // Fallback на другие стемы
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          return this.stemsTracks[key]?.seek() as number;
        }
      }
      return 0;
    } else if (this.musicTrack) {
      return this.musicTrack.seek() as number;
    }
    return 0;
  }

  /**
   * Получает длительность трека
   */
  getDuration(): number {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Используем vocals как основной источник длительности
      if (this.stemsTracks.vocals) {
        return this.stemsTracks.vocals.duration();
      }
      // Fallback на другие стемы
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          const dur = this.stemsTracks[key]?.duration();
          if (dur && dur > 0) return dur;
        }
      }
      return 0;
    } else if (this.musicTrack) {
      return this.musicTrack.duration();
    }
    return 0;
  }

  /**
   * Проверяет, загружен ли трек (длительность доступна)
   */
  isTrackLoaded(): boolean {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Проверяем хотя бы один стем загружен
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key] && this.stemsEnabled[key]) {
          const dur = this.stemsTracks[key]?.duration();
          if (dur && dur > 0 && isFinite(dur)) {
            return true;
          }
        }
      }
      return false;
    } else if (this.musicTrack) {
      const dur = this.musicTrack.duration();
      return dur > 0 && isFinite(dur);
    }
    return false;
  }

  /**
   * Перемещается к указанной позиции
   * Важно: Howler.js сам обрабатывает seek без наслоения звука
   * Если трек играет, он продолжит играть с новой позиции
   */
  seek(time: number) {
    const dur = this.getDuration();
    if (dur === 0 || !isFinite(dur)) {
      console.warn("Cannot seek: track not fully loaded yet");
      return;
    }

    // Ограничиваем время в пределах длительности
    const clampedTime = Math.max(0, Math.min(time, dur));

    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Seek для всех стемов (синхронизированно)
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          try {
            this.stemsTracks[key]?.seek(clampedTime);
          } catch (e) {
            console.warn(`Error seeking stem ${key}:`, e);
          }
        }
      }
    } else if (this.musicTrack) {
      // Seek для цельного файла
      try {
        this.musicTrack.seek(clampedTime);
      } catch (e) {
        console.error("Error during seek:", e);
      }
    }

    // Reset beat index to match the seek position (cursor-based approach)
    this.currentBeatIndex = 0;
    for (let i = 0; i < this.beatMap.length; i++) {
      if (this.beatMap[i] <= clampedTime) {
        this.currentBeatIndex = i;
      } else {
        break;
      }
    }
  }

  // === Управление громкостью ===

  setMusicVolume(volume: number) {
    this.musicVolume = volume;
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      // Обновляем громкость всех стемов
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          const finalVolume =
            (volume / 100) *
            (this.stemsVolume[key] / 100) *
            (this.stemsEnabled[key] ? 1 : 0);
          this.stemsTracks[key]?.volume(finalVolume);
        }
      }
    } else if (this.musicTrack) {
      // Обновляем громкость цельного файла
      this.musicTrack.volume(volume / 100);
    }
  }

  // === Управление стемами ===

  setStemsMode(enabled: boolean) {
    if (this.isStemsMode === enabled) return; // Нет изменений

    this.isStemsMode = enabled;

    // Если режим изменился и трек загружен, нужно перезагрузить трек
    if (this.currentTrack) {
      // Сохраняем текущую позицию и состояние
      const currentTime = this.getCurrentTime();
      const wasPlaying = this.isPlaying();

      // loadTrack сам вызовет stop() и unloadTrack(), поэтому просто вызываем его
      this.loadTrack(
        this.currentTrack,
        this.isStemsMode,
        this.stemsEnabled,
        this.stemsVolume
      );

      // Восстанавливаем позицию и состояние воспроизведения после загрузки
      if (currentTime > 0) {
        setTimeout(() => {
          this.seek(currentTime);
          if (wasPlaying) {
            this.play();
          }
        }, 150); // Немного больше времени для загрузки стемов
      }
    }
  }

  setStemsEnabled(
    stems: Partial<{
      vocals: boolean;
      drums: boolean;
      bass: boolean;
      other: boolean;
    }>
  ) {
    this.stemsEnabled = { ...this.stemsEnabled, ...stems };

    // Обновляем громкость стемов (включенные/выключенные)
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          const finalVolume =
            (this.musicVolume / 100) *
            (this.stemsVolume[key] / 100) *
            (this.stemsEnabled[key] ? 1 : 0);
          this.stemsTracks[key]?.volume(finalVolume);
        }
      }
    }
  }

  setStemsVolume(
    stems: Partial<{
      vocals: number;
      drums: number;
      bass: number;
      other: number;
    }>
  ) {
    this.stemsVolume = { ...this.stemsVolume, ...stems };

    // Обновляем громкость стемов
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          const finalVolume =
            (this.musicVolume / 100) *
            (this.stemsVolume[key] / 100) *
            (this.stemsEnabled[key] ? 1 : 0);
          this.stemsTracks[key]?.volume(finalVolume);
        }
      }
    }
  }

  // === Callbacks ===

  setOnTrackEnd(callback: (() => void) | null) {
    this.onTrackEnd = callback;
  }

  /**
   * Update method - cursor-based approach using beatMap
   * This method is called via requestAnimationFrame during playback
   */
  private update() {
    // Проверяем, играет ли что-то (цельный файл или стемы)
    const isPlaying = this.isPlaying();
    if (!isPlaying) {
      this.stopUpdate();
      return;
    }

    const currentTime = this.getCurrentTime();

    // Update currentBeatIndex based on current time
    // Find the closest beat index that hasn't been passed yet
    while (
      this.currentBeatIndex < this.beatMap.length &&
      this.beatMap[this.currentBeatIndex] <= currentTime
    ) {
      this.currentBeatIndex++;
    }

    // Continue the update loop
    this.updateAnimationFrameId = requestAnimationFrame(() => this.update());
  }

  /**
   * Start the update loop
   */
  private startUpdate() {
    if (this.updateAnimationFrameId !== null) {
      return; // Already running
    }
    this.updateAnimationFrameId = requestAnimationFrame(() => this.update());
  }

  /**
   * Stop the update loop
   */
  private stopUpdate() {
    if (this.updateAnimationFrameId !== null) {
      cancelAnimationFrame(this.updateAnimationFrameId);
      this.updateAnimationFrameId = null;
    }
  }

  /**
   * Get current beat index (for external use)
   */
  getCurrentBeatIndex(): number {
    return this.currentBeatIndex;
  }

  /**
   * Get beat map (for external use)
   */
  getBeatMap(): number[] {
    return [...this.beatMap]; // Return a copy
  }

  // === Cleanup ===

  destroy() {
    this.stop();
    this.unloadTrack();
    this.stopUpdate();

    this.onTrackEnd = null;
  }
}

// Export singleton instance
export const audioEngine = AudioEngine.getInstance();
