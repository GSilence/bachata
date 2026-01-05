import { Howl, Howler } from "howler";
import type { Track, GridMap, Beat } from "@/types";
import {
  generateFallbackBeatGrid,
  generateBeatGridFromDownbeats,
} from "./beatGrid";

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

  // Текущий трек
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private currentTrack: Track | null = null;

  // Настройки
  private musicVolume: number = 100;

  // Stems настройки
  private isStemsMode: boolean = false;
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
  // NEW: Callback для обновления прогресс-бара UI синхронно с движком
  private onTimeUpdate: ((currentTime: number) => void) | null = null;
  // Callback для обновления текущего бита в UI
  private onBeatUpdate: ((beatNumber: number) => void) | null = null;

  private trackEndFired: boolean = false;

  // Internal State
  // NEW: Явный флаг состояния, чтобы избежать гонки (race condition) с Howler
  private _isPlaying: boolean = false;

  // Beat tracking
  private beatMap: number[] = [];
  private beatGrid: Beat[] = [];
  private currentBeatIndex: number = 0;
  private updateAnimationFrameId: number | null = null;
  private updateIntervalId: NodeJS.Timeout | null = null; // Для работы в фоне (неактивная вкладка)
  private lastSectionCheckTime: number = -1; // Для отслеживания проверки секций

  // Voice filter для управления воспроизведением голоса
  private voiceFilter: "mute" | "on1" | "on1and5" | "full" = "full";

  // Voice count files
  private voiceFiles: Map<number, Howl> = new Map();
  private voiceVolume: number = 100;

  private constructor() {
    this.preloadVoiceFiles();
  }

  private preloadVoiceFiles() {
    // Пропускаем загрузку на сервере (SSR) - Howl.js работает только в браузере
    if (typeof window === "undefined") {
      return;
    }

    for (let i = 1; i <= 8; i++) {
      const voicePath = `/audio/voice/${i}.mp3`;
      const howl = new Howl({
        src: [voicePath],
        html5: true,
        preload: true,
        volume: this.voiceVolume / 100,
        onloaderror: (id, error) => {
          console.warn(`Failed to load voice file ${voicePath}:`, error);
        },
      });
      this.voiceFiles.set(i, howl);
    }
  }

  static getInstance(): AudioEngine {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

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
    if (!track.pathOriginal) {
      console.warn("Cannot load track: pathOriginal is missing");
      return;
    }

    // 1. Сброс состояния
    this.stop();
    this.unloadTrack();

    // 2. Применение настроек
    if (isStemsMode !== undefined) this.isStemsMode = isStemsMode;
    if (stemsEnabled)
      this.stemsEnabled = { ...this.stemsEnabled, ...stemsEnabled };
    if (stemsVolume) this.stemsVolume = { ...this.stemsVolume, ...stemsVolume };

    this.currentTrack = track;
    this.trackEndFired = false;
    this.currentBeatIndex = 0;
    this._isPlaying = false; // Reset playing state

    // 3. Beat Grid - генерируем из gridMap если есть, иначе используем fallback
    if (track.gridMap && track.gridMap.grid && track.gridMap.grid.length > 0) {
      // Используем gridMap для генерации точного beatGrid с учетом мостиков
      // Получаем длительность трека из gridMap (из результата анализа) или используем фоллбек
      const duration = track.gridMap.duration || 180
      this.beatGrid = generateBeatGridFromDownbeats(
        track.gridMap,
        duration
      );
      console.log(
        `[AudioEngine] Generated beatGrid from gridMap: ${this.beatGrid.length} beats, ${track.gridMap.grid.length} sections, duration: ${duration}s`
      );
    } else if (track.beatGrid && track.beatGrid.length > 0) {
      // Используем предварительно сгенерированный beatGrid (если есть)
      this.beatGrid = track.beatGrid;
      console.log(
        `[AudioEngine] Using pre-generated beatGrid: ${this.beatGrid.length} beats`
      );
    } else {
      // Fallback: генерируем простой beatGrid без учета мостиков
      // Используем duration из gridMap если есть, иначе фоллбек
      const duration = track.gridMap?.duration || 180;
      const bpm = track.bpm || 120;
      const offset = track.offset || 0;
      this.beatGrid = generateFallbackBeatGrid(bpm, offset, duration);
      console.log(
        `[AudioEngine] Using fallback beatGrid: ${this.beatGrid.length} beats, duration: ${duration}s`
      );
    }

    this.buildBeatMap(track);

    // 4. Загрузка аудио
    if (this.isStemsMode && track.isProcessed) {
      this.loadStems(track);
    } else {
      this.loadFullFile(track);
    }
  }

  private loadFullFile(track: Track) {
    if (!track.pathOriginal) return;

    this.musicTrack = new Howl({
      src: [track.pathOriginal],
      html5: true,
      preload: true,
      volume: this.musicVolume / 100,
      onend: () => {
        this.handleTrackEnd();
      },
      onloaderror: (id, error) => {
        console.error("Howl load error:", error);
      },
    });
  }

  private loadStems(track: Track) {
    // После загрузки стемов обновляем beatGrid с правильной длительностью
    const updateBeatGridAfterLoad = () => {
      if (this.currentTrack?.gridMap) {
        // Используем длительность из vocals (или другого доступного стема)
        let duration = 0;
        if (this.stemsTracks.vocals) {
          duration = this.stemsTracks.vocals.duration();
        } else if (this.stemsTracks.drums) {
          duration = this.stemsTracks.drums.duration();
        } else if (this.stemsTracks.bass) {
          duration = this.stemsTracks.bass.duration();
        } else if (this.stemsTracks.other) {
          duration = this.stemsTracks.other.duration();
        }

        if (duration && duration > 0) {
          // Регенерируем beatGrid с правильной длительностью
          this.beatGrid = generateBeatGridFromDownbeats(
            this.currentTrack.gridMap,
            duration
          );
          console.log(
            `[AudioEngine] Updated beatGrid with actual duration from stems: ${duration}s, ${this.beatGrid.length} beats`
          );
        }
      }
    };
    if (
      !track.pathVocals ||
      !track.pathDrums ||
      !track.pathBass ||
      !track.pathOther
    ) {
      console.warn("Missing stem paths, falling back to full file");
      this.loadFullFile(track);
      return;
    }

    let loadedStemsCount = 0;
    const totalStems = 4;

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
        onload: () => {
          loadedStemsCount++;
          // После загрузки всех стемов обновляем beatGrid
          if (loadedStemsCount === totalStems) {
            updateBeatGridAfterLoad();
          }
        },
        onloaderror: (id, error) => {
          console.error(`Howl load error for stem ${src}:`, error);
        },
      });
    };

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

    // Используем vocals как мастер для события окончания
    if (this.stemsTracks.vocals) {
      this.stemsTracks.vocals.on("end", () => {
        this.handleTrackEnd();
      });
    }
  }

  // Централизованный обработчик окончания трека
  private handleTrackEnd() {
    this._isPlaying = false;
    this.stopUpdate(); // Останавливаем цикл
    if (this.onTrackEnd && !this.trackEndFired) {
      this.trackEndFired = true;
      this.onTrackEnd();
    }
  }

  private buildBeatMap(track: Track) {
    this.beatMap = [];
    if (track.gridMap && track.gridMap.grid) {
      for (const section of track.gridMap.grid) {
        const beatsPerSecond = (track.gridMap.bpm / 60) * 4;
        const beatInterval = 1 / beatsPerSecond;
        for (let i = 0; i < section.beats; i++) {
          this.beatMap.push(section.start + i * beatInterval);
        }
      }
    } else {
      const bpm = track.bpm || 120;
      const offset = track.offset || 0;
      const beatsPerSecond = (bpm / 60) * 4;
      const beatInterval = 1 / beatsPerSecond;
      const estimatedDuration = 180;
      const totalBeats = Math.ceil(estimatedDuration * beatsPerSecond);
      for (let i = 0; i < totalBeats; i++) {
        this.beatMap.push(offset + i * beatInterval);
      }
    }
  }

  unloadTrack() {
    this.stopUpdate();
    this._isPlaying = false;

    if (this.musicTrack) {
      this.musicTrack.stop();
      this.musicTrack.unload();
      this.musicTrack = null;
    }

    const stemKeys: Array<keyof typeof this.stemsTracks> = [
      "vocals",
      "drums",
      "bass",
      "other",
    ];
    for (const key of stemKeys) {
      if (this.stemsTracks[key]) {
        this.stemsTracks[key]?.stop();
        this.stemsTracks[key]?.unload();
        this.stemsTracks[key] = null;
      }
    }

    try {
      Howler.unload();
    } catch (e) {
      console.warn("Error calling Howler.unload():", e);
    }

    this.currentTrack = null;
    this.trackEndFired = false;
    this.beatMap = [];
    this.beatGrid = [];
    this.currentBeatIndex = 0;
  }

  play() {
    // 1. Set INTENT to play immediately (fixes UI race condition)
    this._isPlaying = true;

    // 2. Trigger audio playback
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key] && this.stemsEnabled[key]) {
          this.stemsTracks[key]?.play();
        }
      }
    } else if (this.musicTrack) {
      this.musicTrack.play();
    }

    // 3. Sync and Start Loop
    const currentTime = this.getCurrentTime();

    // Sync cursor
    const immediateBeatIndex = this.syncBeatCursor(currentTime);

    // Play immediate beat logic
    if (immediateBeatIndex >= 0 && immediateBeatIndex < this.beatGrid.length) {
      const beat = this.beatGrid[immediateBeatIndex];
      if (beat) {
        this.playVoiceCount(beat.number);
        this.currentBeatIndex = immediateBeatIndex + 1;
      }
    }

    // 4. Start update loop (it will now stay alive because _isPlaying is true)
    this.startUpdate();
  }

  pause() {
    this._isPlaying = false; // Set INTENT to pause

    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        this.stemsTracks[key]?.pause();
      }
    } else if (this.musicTrack) {
      this.musicTrack.pause();
    }
    this.stopUpdate();
  }

  stop() {
    this._isPlaying = false;

    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key]) {
          this.stemsTracks[key]?.stop();
          this.stemsTracks[key]?.seek(0);
        }
      }
    } else if (this.musicTrack) {
      this.musicTrack.stop();
      this.musicTrack.seek(0);
    }
    this.trackEndFired = false;
    this.currentBeatIndex = 0;
    this.stopUpdate();

    // Notify UI of reset to 0
    if (this.onTimeUpdate) this.onTimeUpdate(0);
  }

  /**
   * Исправлено: теперь возвращает явный флаг _isPlaying.
   * Это предотвращает "мигание" состояния UI при старте, когда Howler еще думает.
   */
  isPlaying(): boolean {
    return this._isPlaying;
  }

  getCurrentTime(): number {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      if (this.stemsTracks.vocals)
        return this.stemsTracks.vocals.seek() as number;

      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        if (this.stemsTracks[key])
          return this.stemsTracks[key]?.seek() as number;
      }
      return 0;
    } else if (this.musicTrack) {
      return this.musicTrack.seek() as number;
    }
    return 0;
  }

  getDuration(): number {
    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      if (this.stemsTracks.vocals) return this.stemsTracks.vocals.duration();
      // fallback...
    } else if (this.musicTrack) {
      return this.musicTrack.duration();
    }
    return 0;
  }

  isTrackLoaded(): boolean {
    if (!this.currentTrack) return false;

    if (this.isStemsMode && this.currentTrack.isProcessed) {
      // Проверяем, что все стемы загружены
      return !!(
        this.stemsTracks.vocals &&
        this.stemsTracks.drums &&
        this.stemsTracks.bass &&
        this.stemsTracks.other
      );
    } else {
      // Проверяем, что основной трек загружен
      return !!this.musicTrack;
    }
  }

  /**
   * Получает текущий номер бита (1-8) для отображения в UI
   * Возвращает номер бита из beatGrid на основе текущего времени
   */
  getCurrentBeat(): number {
    if (this.beatGrid.length === 0) {
      return 1; // По умолчанию
    }

    const currentTime = this.getCurrentTime();

    // Находим ближайший прошедший бит
    for (let i = this.beatGrid.length - 1; i >= 0; i--) {
      const beat = this.beatGrid[i];
      if (beat.time <= currentTime) {
        return beat.number;
      }
    }

    // Если не нашли, возвращаем первый бит
    return this.beatGrid[0]?.number || 1;
  }

  seek(time: number) {
    const dur = this.getDuration();
    if (dur === 0) return;

    // Сохраняем намерение воспроизведения, а не физическое состояние Howler
    const wasPlaying = this._isPlaying;

    this.stopUpdate();
    const clampedTime = Math.max(0, Math.min(time, dur));

    if (this.isStemsMode && this.currentTrack?.isProcessed) {
      const stemKeys: Array<keyof typeof this.stemsTracks> = [
        "vocals",
        "drums",
        "bass",
        "other",
      ];
      for (const key of stemKeys) {
        this.stemsTracks[key]?.seek(clampedTime);
      }
    } else if (this.musicTrack) {
      this.musicTrack.seek(clampedTime);
    }

    const immediateBeatIndex = this.syncBeatCursor(clampedTime);
    if (immediateBeatIndex >= 0 && immediateBeatIndex < this.beatGrid.length) {
      const beat = this.beatGrid[immediateBeatIndex];
      if (beat) {
        this.playVoiceCount(beat.number);
        this.currentBeatIndex = immediateBeatIndex + 1;
      }
    }

    // Notify UI immediately (smooth scrubbing)
    if (this.onTimeUpdate) this.onTimeUpdate(clampedTime);

    if (wasPlaying) {
      this.startUpdate();
    }
  }

  // === Setters ===

  setMusicVolume(volume: number) {
    this.musicVolume = volume;
    this.applyVolume();
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
    this.applyVolume();
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
    this.applyVolume();
  }

  // Helper to DRY volume logic
  private applyVolume() {
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
    } else if (this.musicTrack) {
      this.musicTrack.volume(this.musicVolume / 100);
    }
  }

  setStemsMode(enabled: boolean) {
    if (this.isStemsMode === enabled) return;
    this.isStemsMode = enabled;
    if (this.currentTrack) {
      const currentTime = this.getCurrentTime();
      const wasPlaying = this._isPlaying;

      this.loadTrack(
        this.currentTrack,
        this.isStemsMode,
        this.stemsEnabled,
        this.stemsVolume
      );

      if (currentTime > 0) {
        setTimeout(() => {
          this.seek(currentTime);
          if (wasPlaying) this.play();
        }, 150);
      }
    }
  }

  setVoiceVolume(volume: number) {
    this.voiceVolume = Math.max(0, Math.min(100, volume));
    this.voiceFiles.forEach((howl) => howl.volume(this.voiceVolume / 100));
  }

  setVoiceFilter(filter: "mute" | "on1" | "on1and5" | "full") {
    this.voiceFilter = filter;
  }

  // === Callbacks ===

  setOnTrackEnd(callback: (() => void) | null) {
    this.onTrackEnd = callback;
  }

  /**
   * Устанавливает callback для получения текущего времени.
   * Позволяет UI синхронизироваться с AudioEngine без лишних интервалов.
   */
  setOnTimeUpdate(callback: ((time: number) => void) | null) {
    this.onTimeUpdate = callback;
  }

  /**
   * Устанавливает callback для обновления текущего бита.
   * Вызывается при каждом новом бите для синхронизации UI счетчика.
   */
  setOnBeatUpdate(callback: ((beatNumber: number) => void) | null) {
    this.onBeatUpdate = callback;
  }

  // === Internal Logic ===

  private syncBeatCursor(time: number): number {
    if (!this.beatGrid || this.beatGrid.length === 0) {
      this.currentBeatIndex = 0;
      return -1;
    }
    const nextBeatIndex = this.beatGrid.findIndex((beat) => beat.time > time);
    if (nextBeatIndex === -1) {
      this.currentBeatIndex = this.beatGrid.length;
      return -1;
    } else {
      this.currentBeatIndex = nextBeatIndex;
    }
    const nextBeat = this.beatGrid[this.currentBeatIndex];
    if (nextBeat && nextBeat.time <= time + 0.1) {
      return this.currentBeatIndex;
    }
    return -1;
  }

  private update() {
    // CRITICAL FIX: Не проверяем isPlaying() здесь жестко для остановки цикла.
    // Если этот метод вызван, значит мы планировали обновление.
    // Проверка isPlaying нужна только чтобы не двигать логику, если мы на паузе (но update по идее остановлен там).

    const currentTime = this.getCurrentTime();

    // 1. Уведомляем UI (для прогресс-бара)
    if (this.onTimeUpdate) {
      this.onTimeUpdate(currentTime);
    }

    // 2. Проверка секций (Bridge/Verse) для корректировки счетчика
    // Проверяем каждые 0.5 секунды, чтобы не перегружать систему
    if (currentTime - this.lastSectionCheckTime > 0.5) {
      this.checkAndCorrectSectionAlignment(currentTime);
      this.lastSectionCheckTime = currentTime;
    }

    // 3. Обработка битов (Voice Counting)
    if (this.beatGrid.length > 0) {
      while (
        this.currentBeatIndex < this.beatGrid.length &&
        this.beatGrid[this.currentBeatIndex].time <= currentTime
      ) {
        const beat = this.beatGrid[this.currentBeatIndex];
        if (currentTime - beat.time < 0.25) {
          this.playVoiceCount(beat.number);
          // Уведомляем UI о новом бите
          if (this.onBeatUpdate) {
            this.onBeatUpdate(beat.number);
          }
        }
        this.currentBeatIndex++;
      }

      // Check next beat "very soon" logic
      if (
        this.currentBeatIndex < this.beatGrid.length &&
        this.beatGrid[this.currentBeatIndex].time > currentTime &&
        this.beatGrid[this.currentBeatIndex].time <= currentTime + 0.05
      ) {
        const beat = this.beatGrid[this.currentBeatIndex];
        this.playVoiceCount(beat.number);
        // Уведомляем UI о новом бите
        if (this.onBeatUpdate) {
          this.onBeatUpdate(beat.number);
        }
        this.currentBeatIndex++;
      }
    } else {
      // Legacy beatMap
      while (
        this.currentBeatIndex < this.beatMap.length &&
        this.beatMap[this.currentBeatIndex] <= currentTime
      ) {
        this.currentBeatIndex++;
      }
    }

    // Continue loop - setInterval уже запущен в startUpdate()
    // Не нужно создавать новый интервал здесь
  }

  /**
   * Проверяет и корректирует выравнивание счетчика на границах секций
   * Применяет "Танцевальную логику Бачаты": не вызывает панический сброс
   *
   * Логика:
   * - Сброс на "1" только для длинных секций (> 8 beats)
   * - Короткие мостики (4 beats) могут сбрасывать логично
   * - Микро-секции (1-2 beats) полностью игнорируются
   * - Если коррекция незначительна (разница 1-2 бита) - не сбрасываем
   *
   * IMPORTANT: Не вызывает панический сброс, если коррекция незначительна.
   * Счет должен идти плавно "1, 2, 3, 4, 5, 6, 7, 8" без постоянных сбросов.
   */
  private checkAndCorrectSectionAlignment(currentTime: number) {
    if (!this.currentTrack?.gridMap?.grid || this.beatGrid.length === 0) {
      return; // Нет данных о секциях
    }

    const sections = this.currentTrack.gridMap.grid;
    const bpm = this.currentTrack.gridMap.bpm || this.currentTrack.bpm || 120;
    const beatInterval = 60 / bpm;

    // Пороги для "Танцевальной логики Бачаты"
    const MIN_SECTION_BEATS_FOR_RESET = 8; // Минимальная длина для сброса (2 такта)
    const SHORT_BRIDGE_BEATS = 4; // Короткий мостик
    const MICRO_SECTION_BEATS = 2; // Микро-секции - игнорируем
    const MAX_BEAT_DIFF_FOR_IGNORE = 2; // Если разница <= 2 бита, не сбрасываем

    // Проверяем каждую секцию
    for (const section of sections) {
      const sectionStart = section.start;
      const tolerance = 0.2; // Допуск 0.2 секунды

      // ЗАПРЕТ НА МИКРО-СБРОСЫ: Полностью игнорируем секции короче 2 битов
      if (section.beats < MICRO_SECTION_BEATS) {
        continue; // Игнорируем микро-секции
      }

      // Если мы находимся в начале секции (в пределах tolerance)
      if (Math.abs(currentTime - sectionStart) < tolerance) {
        // Находим текущий beat в beatGrid
        const currentBeat = this.beatGrid[this.currentBeatIndex];

        if (!currentBeat) {
          continue;
        }

        const currentBeatNumber = currentBeat.number;

        // ЛОГИКА СБРОСА: Применяем "Танцевальную логику Бачаты"
        let shouldReset = false;
        let resetReason = "";

        if (section.beats >= MIN_SECTION_BEATS_FOR_RESET) {
          // ДЛИННАЯ СЕКЦИЯ (> 8 beats): Всегда сбрасываем на "1"
          // Это реальная граница Куплета/Припева
          if (currentBeatNumber !== 1) {
            shouldReset = true;
            resetReason = `Long section (${section.beats} beats) - real phrase boundary`;
          }
        } else if (section.beats === SHORT_BRIDGE_BEATS && section.type === "bridge") {
          // КОРОТКИЙ МОСТИК (ровно 4 beats): Логичный сброс на "1"
          // 4 бита = законченный такт
          if (currentBeatNumber !== 1) {
            shouldReset = true;
            resetReason = `Short bridge (${section.beats} beats) - complete measure`;
          }
        } else if (section.beats >= 4 && section.beats < MIN_SECTION_BEATS_FOR_RESET) {
          // СРЕДНЯЯ СЕКЦИЯ (4-7 beats): Сбрасываем только если разница значительна
          // Если текущий счет близок к "1" (1, 2, 8) - не сбрасываем
          // Если текущий счет далек от "1" (3-7) - сбрасываем
          const beatDiff = Math.min(
            Math.abs(currentBeatNumber - 1),
            Math.abs(currentBeatNumber - 9) // Учитываем цикл (8 -> 1)
          );
          
          if (beatDiff > MAX_BEAT_DIFF_FOR_IGNORE) {
            shouldReset = true;
            resetReason = `Medium section (${section.beats} beats) - significant difference (${beatDiff} beats)`;
          }
        }

        // Применяем коррекцию только если нужно
        if (shouldReset) {
          console.log(
            `[Section Correction] ${section.type} section at ${sectionStart.toFixed(2)}s ` +
            `(${section.beats} beats). Current: ${currentBeatNumber}, Resetting to 1. ` +
            `Reason: ${resetReason}`
          );

          // Находим ближайший beat к началу секции и корректируем его
          let corrected = false;
          for (let i = 0; i < this.beatGrid.length; i++) {
            const beat = this.beatGrid[i];
            if (Math.abs(beat.time - sectionStart) < tolerance) {
              // Корректируем этот beat и последующие beats в секции
              const sectionEnd = sectionStart + section.beats * beatInterval;
              let beatNum = 1;

              for (let j = i; j < this.beatGrid.length; j++) {
                const secBeat = this.beatGrid[j];
                if (
                  secBeat.time >= sectionStart - tolerance &&
                  secBeat.time <= sectionEnd + tolerance
                ) {
                  secBeat.number = beatNum;
                  beatNum = (beatNum % 8) + 1;
                } else if (secBeat.time > sectionEnd) {
                  break;
                }
              }

              corrected = true;
              break;
            }
          }

          if (corrected) {
            // Синхронизируем currentBeatIndex с текущим временем
            this.syncBeatCursor(currentTime);
          }
        } else if (currentBeatNumber !== 1) {
          // Логируем, что сброс не нужен (для отладки)
          console.log(
            `[Section Alignment] ${section.type} section at ${sectionStart.toFixed(2)}s ` +
            `(${section.beats} beats). Current: ${currentBeatNumber}, No reset needed.`
          );
        }
      }
    }
  }

  private playVoiceCount(beatNumber: number) {
    if (beatNumber < 1 || beatNumber > 8) return;

    // Применяем voice filter
    let shouldPlay = false;

    switch (this.voiceFilter) {
      case "mute":
        shouldPlay = false;
        break;
      case "on1":
        shouldPlay = beatNumber === 1;
        break;
      case "on1and5":
        shouldPlay = beatNumber === 1 || beatNumber === 5;
        break;
      case "full":
        shouldPlay = true;
        break;
    }

    if (!shouldPlay) return;

    const voiceFile = this.voiceFiles.get(beatNumber);
    if (voiceFile) {
      // Опционально: не прерывать, если голос тот же, но здесь лучше прерывать для четкости
      voiceFile.stop();
      voiceFile.play();
    }
  }

  private startUpdate() {
    // Используем setInterval для работы в фоне (неактивная вкладка)
    if (this.updateIntervalId !== null) return;

    // Проверяем видимость страницы для оптимизации частоты обновлений
    const interval =
      typeof document !== "undefined" && document.hidden ? 50 : 16;
    this.updateIntervalId = setInterval(() => this.update(), interval);

    // Также слушаем изменения видимости для оптимизации частоты обновлений
    if (typeof document !== "undefined" && !this.visibilityHandler) {
      const handleVisibilityChange = () => {
        if (this.updateIntervalId !== null && this._isPlaying) {
          clearInterval(this.updateIntervalId);
          this.updateIntervalId = null;
          // Перезапускаем с новой частотой
          const newInterval = document.hidden ? 50 : 16;
          this.updateIntervalId = setInterval(() => this.update(), newInterval);
        }
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      this.visibilityHandler = handleVisibilityChange;
    }
  }

  private visibilityHandler: (() => void) | null = null;

  private stopUpdate() {
    if (this.updateIntervalId !== null) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }
    if (this.updateAnimationFrameId !== null) {
      cancelAnimationFrame(this.updateAnimationFrameId);
      this.updateAnimationFrameId = null;
    }
    // Удаляем обработчик видимости
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  destroy() {
    this.stop();
    this.unloadTrack();
    this.onTrackEnd = null;
    this.onTimeUpdate = null;
    this.onBeatUpdate = null;
  }
}

// Экспортируем экземпляр AudioEngine
// Примечание: preloadVoiceFiles() проверяет наличие window,
// поэтому ошибки загрузки на сервере не будут возникать
export const audioEngine = AudioEngine.getInstance();
