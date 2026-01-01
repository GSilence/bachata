import { Howl, Howler } from "howler";
import type { Track, GridMap, Beat } from "@/types";
import { generateFallbackBeatGrid } from "./beatGrid";

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

  private trackEndFired: boolean = false;

  // Internal State
  // NEW: Явный флаг состояния, чтобы избежать гонки (race condition) с Howler
  private _isPlaying: boolean = false;

  // Beat tracking
  private beatMap: number[] = [];
  private beatGrid: Beat[] = [];
  private currentBeatIndex: number = 0;
  private updateAnimationFrameId: number | null = null;

  // Voice count files
  private voiceFiles: Map<number, Howl> = new Map();
  private voiceVolume: number = 100;

  private constructor() {
    this.preloadVoiceFiles();
  }

  private preloadVoiceFiles() {
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

    // 3. Beat Grid
    if (track.beatGrid && track.beatGrid.length > 0) {
      this.beatGrid = track.beatGrid;
    } else {
      const estimatedDuration = 180;
      const bpm = track.bpm || 120;
      const offset = track.offset || 0;
      this.beatGrid = generateFallbackBeatGrid(bpm, offset, estimatedDuration);
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

    // 2. Обработка битов (Voice Counting)
    if (this.beatGrid.length > 0) {
      while (
        this.currentBeatIndex < this.beatGrid.length &&
        this.beatGrid[this.currentBeatIndex].time <= currentTime
      ) {
        const beat = this.beatGrid[this.currentBeatIndex];
        if (currentTime - beat.time < 0.25) {
          this.playVoiceCount(beat.number);
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

    // Continue loop
    this.updateAnimationFrameId = requestAnimationFrame(() => this.update());
  }

  private playVoiceCount(beatNumber: number) {
    if (beatNumber < 1 || beatNumber > 8) return;
    const voiceFile = this.voiceFiles.get(beatNumber);
    if (voiceFile) {
      // Опционально: не прерывать, если голос тот же, но здесь лучше прерывать для четкости
      voiceFile.stop();
      voiceFile.play();
    }
  }

  private startUpdate() {
    if (this.updateAnimationFrameId !== null) return;
    this.updateAnimationFrameId = requestAnimationFrame(() => this.update());
  }

  private stopUpdate() {
    if (this.updateAnimationFrameId !== null) {
      cancelAnimationFrame(this.updateAnimationFrameId);
      this.updateAnimationFrameId = null;
    }
  }

  destroy() {
    this.stop();
    this.unloadTrack();
    this.onTrackEnd = null;
    this.onTimeUpdate = null;
  }
}

export const audioEngine = AudioEngine.getInstance();
