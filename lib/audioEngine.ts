import { Howl, Howler } from "howler";
import type { Track, GridMap, Beat } from "@/types";
import { generateFallbackBeatGrid } from "./beatGrid";

// Debug flags
let hasLoggedVoicePlayback = false;
// ТЕСТ: Отключить Silent Anchor чтобы проверить, вызывает ли он шум
const DISABLE_SILENT_ANCHOR_TEST = false;

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
  private beatGrid: Beat[] = [];
  private currentBeatIndex: number = 0;
  private updateAnimationFrameId: number | null = null;
  private updateIntervalId: NodeJS.Timeout | null = null; // Для работы в фоне (неактивная вкладка)

  // Voice filter для управления воспроизведением голоса
  private voiceFilter: "mute" | "on1" | "on1and5" | "full" = "full";
  private voiceLanguage: "en" | "pt" = "en";

  // Voice count files (Howl — запасной путь)
  private voiceFiles: Map<number, Howl> = new Map();
  private voiceVolume: number = 100;

  // Web Audio для счёта: планирование заранее, чтобы работало при неактивной вкладке
  private voiceCtx: AudioContext | null = null;
  private voiceBuffers: Map<number, AudioBuffer> = new Map();
  private voiceGain: GainNode | null = null;
  private lastScheduledVoiceBeatIndex: number = -1;
  private static readonly SCHEDULE_AHEAD_SEC = 1.5;

  // Активные BufferSource nodes для немедленной остановки при паузе
  private activeVoiceSources: Set<AudioBufferSourceNode> = new Set();

  // Silent Anchor: держит AudioContext активным в фоне
  private silentOscillator: OscillatorNode | null = null;
  private silentGain: GainNode | null = null;
  private isSilentAnchorRunning: boolean = false;

  private constructor() {
    this.preloadVoiceFiles();
    // Web Audio для счёта: теперь с правильным gain (без искажений)
    this.initVoiceWebAudio();
  }

  private preloadVoiceFiles() {
    // Пропускаем загрузку на сервере (SSR) - Howl.js работает только в браузере
    if (typeof window === "undefined") {
      return;
    }

    for (let i = 1; i <= 8; i++) {
      const voicePath = `/audio/voice/${this.voiceLanguage}/${i}.m4a`;
      const howl = new Howl({
        src: [voicePath],
        html5: true, // Используем HTML5 Audio для надежности
        preload: true,
        volume: this.voiceVolume / 100,
        onloaderror: (id, error) => {
          console.warn(`Failed to load voice file ${voicePath}:`, error);
        },
      });
      this.voiceFiles.set(i, howl);
    }
  }

  private initVoiceWebAudio() {
    if (typeof window === "undefined") return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;

      // КРИТИЧНО: Создаем AudioContext с 44100 Hz чтобы избежать resampling!
      // Наши файлы 44100 Hz, поэтому никакой конвертации → чистый звук
      this.voiceCtx = new Ctx({ sampleRate: 44100 });

      // Создаем gain node
      this.voiceGain = this.voiceCtx.createGain();
      this.voiceGain.gain.value = this.voiceVolume / 100;
      this.voiceGain.connect(this.voiceCtx.destination);

      this.loadVoiceBuffers();
    } catch {
      // Web Audio недоступен — остаётся Howl
    }
  }

  private async loadVoiceBuffers() {
    if (!this.voiceCtx) return;
    console.log(`[AudioEngine] Loading voice buffers via Web Audio...`);
    console.log(
      `[AudioEngine] AudioContext sample rate: ${this.voiceCtx.sampleRate} Hz`,
    );

    for (let i = 1; i <= 8; i++) {
      try {
        const r = await fetch(`/audio/voice/${this.voiceLanguage}/${i}.m4a`);
        const ab = await r.arrayBuffer();
        const buf = await this.voiceCtx.decodeAudioData(ab);
        this.voiceBuffers.set(i, buf);

        if (i === 1) {
          // Анализируем первый буфер подробно
          const channelData = buf.getChannelData(0);
          let maxPeak = 0;
          let minPeak = 0;
          let hasNaN = false;

          for (let j = 0; j < channelData.length; j++) {
            const sample = channelData[j];
            if (isNaN(sample)) {
              hasNaN = true;
              break;
            }
            if (sample > maxPeak) maxPeak = sample;
            if (sample < minPeak) minPeak = sample;
          }

          console.log(`[AudioEngine] Buffer ${i} decoded:`, {
            sampleRate: buf.sampleRate,
            channels: buf.numberOfChannels,
            duration: buf.duration.toFixed(3),
            length: buf.length,
            maxPeak: maxPeak.toFixed(4),
            minPeak: minPeak.toFixed(4),
            peakToPeak: (maxPeak - minPeak).toFixed(4),
            hasNaN,
            fileSize: `${(ab.byteLength / 1024).toFixed(1)} KB`,
          });

          // ПРЕДУПРЕЖДЕНИЕ: если пики близки к 1.0, файл может клипировать
          if (maxPeak > 0.95 || minPeak < -0.95) {
            console.warn(
              `[AudioEngine] ⚠️ Buffer ${i} has high peaks (>0.95), may clip!`,
            );
          }
        }
      } catch (err) {
        console.warn(`[AudioEngine] Failed to load voice buffer ${i}:`, err);
      }
    }
    console.log(
      `[AudioEngine] Loaded ${this.voiceBuffers.size}/8 voice buffers`,
    );
    console.log(
      `[AudioEngine] Current voiceGain value: ${this.voiceGain?.gain.value}`,
    );
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
    stemsVolume?: {
      vocals: number;
      drums: number;
      bass: number;
      other: number;
    },
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

    // 3. Beat Grid — простая сетка 1–8 по BPM и offset, без сбросов по секциям (мостики пока не используем)
    const duration = track.gridMap?.duration || 180;
    const bpm = track.bpm || 120;
    const offset = track.offset || 0;
    this.beatGrid = generateFallbackBeatGrid(bpm, offset, duration);

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
      const t = this.currentTrack;
      if (!t) return;
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
      if (duration > 0) {
        this.beatGrid = generateFallbackBeatGrid(
          t.bpm || 120,
          t.offset || 0,
          duration,
        );
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
      enabled: boolean,
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
      this.stemsEnabled.vocals,
    );
    this.stemsTracks.drums = createStem(
      track.pathDrums!,
      this.stemsVolume.drums,
      this.stemsEnabled.drums,
    );
    this.stemsTracks.bass = createStem(
      track.pathBass!,
      this.stemsVolume.bass,
      this.stemsEnabled.bass,
    );
    this.stemsTracks.other = createStem(
      track.pathOther!,
      this.stemsVolume.other,
      this.stemsEnabled.other,
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
    this.beatGrid = [];
    this.currentBeatIndex = 0;
    this.lastScheduledVoiceBeatIndex = -1;
  }

  async play() {
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

    // Разблокируем Web Audio на жесте пользователя (нужно для iOS)
    // ВАЖНО: ждем завершения resume() перед воспроизведением!
    if (this.voiceCtx?.state === "suspended") {
      await this.voiceCtx.resume();
      console.log(
        "[AudioEngine] AudioContext resumed, state:",
        this.voiceCtx.state,
      );
    }
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

    // С какого бита планировать счёт вперёд (Web Audio)
    this.lastScheduledVoiceBeatIndex = this.currentBeatIndex - 1;

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
    this.lastScheduledVoiceBeatIndex = -1;

    // ВАЖНО: останавливаем все запланированные биты немедленно
    this.stopAllScheduledVoices();

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
    this.lastScheduledVoiceBeatIndex = -1;

    // ВАЖНО: останавливаем все запланированные биты немедленно
    this.stopAllScheduledVoices();

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

    // КРИТИЧНО: Останавливаем все запланированные биты при перемотке!
    // Иначе они будут играть в запланированное время, даже если мы перемотали вперед/назад
    this.stopAllScheduledVoices();

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

    this.lastScheduledVoiceBeatIndex = this.currentBeatIndex - 1;

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
    }>,
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
    }>,
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
        this.stemsVolume,
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
    // Прямая громкость без лимитов
    const actualVolume = this.voiceVolume / 100;

    if (this.voiceGain) {
      this.voiceGain.gain.value = actualVolume;
    }
    this.voiceFiles.forEach((howl) => {
      howl.volume(actualVolume);
    });
  }

  setVoiceFilter(filter: "mute" | "on1" | "on1and5" | "full") {
    this.voiceFilter = filter;
  }

  setVoiceLanguage(language: "en" | "pt") {
    if (this.voiceLanguage === language) return;
    this.voiceLanguage = language;

    // Очищаем старые буферы и перезагружаем
    this.voiceFiles.forEach((howl) => howl.unload());
    this.voiceFiles.clear();
    this.voiceBuffers.clear();

    this.preloadVoiceFiles();
    this.loadVoiceBuffers();
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

    // 2. Обработка битов: UI (onBeatUpdate) всегда; звук — только один источник, иначе эхо.
    // При Web Audio звук идёт только из scheduleVoiceAhead(); при Howl — из playVoiceCount().
    const useWebAudioVoice = this.voiceBuffers.size >= 8;

    if (this.beatGrid.length > 0) {
      while (
        this.currentBeatIndex < this.beatGrid.length &&
        this.beatGrid[this.currentBeatIndex].time <= currentTime
      ) {
        const beat = this.beatGrid[this.currentBeatIndex];
        if (currentTime - beat.time < 0.25) {
          if (!useWebAudioVoice) this.playVoiceCount(beat.number);
          if (this.onBeatUpdate) this.onBeatUpdate(beat.number);
        }
        this.currentBeatIndex++;
      }

      if (
        this.currentBeatIndex < this.beatGrid.length &&
        this.beatGrid[this.currentBeatIndex].time > currentTime &&
        this.beatGrid[this.currentBeatIndex].time <= currentTime + 0.05
      ) {
        const beat = this.beatGrid[this.currentBeatIndex];
        if (!useWebAudioVoice) this.playVoiceCount(beat.number);
        if (this.onBeatUpdate) this.onBeatUpdate(beat.number);
        this.currentBeatIndex++;
      }
    }

    // Планируем счёт вперёд (Web Audio). Единственный источник звука при useWebAudioVoice.
    this.scheduleVoiceAhead();

    // Continue loop - setInterval уже запущен в startUpdate()
    // Не нужно создавать новый интервал здесь
  }

  private shouldPlayVoiceForBeat(beatNumber: number): boolean {
    switch (this.voiceFilter) {
      case "mute":
        return false;
      case "on1":
        return beatNumber === 1;
      case "on1and5":
        return beatNumber === 1 || beatNumber === 5;
      case "full":
        return true;
      default:
        return false;
    }
  }

  /**
   * Останавливает все запланированные биты немедленно.
   * Вызывается при паузе/стопе чтобы счет не продолжал играть.
   */
  private stopAllScheduledVoices() {
    this.activeVoiceSources.forEach((src) => {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Source может быть уже остановлен
      }
    });
    this.activeVoiceSources.clear();
  }

  /** Планирует один удар счёта на точное время (стена-часы). Работает при неактивной вкладке. */
  private scheduleVoiceAt(beatNumber: number, whenWallSec: number) {
    if (beatNumber < 1 || beatNumber > 8 || !this.voiceCtx || !this.voiceGain)
      return;
    const buf = this.voiceBuffers.get(beatNumber);
    if (!buf) return;

    // Логируем первые несколько воспроизведений для диагностики
    if (beatNumber === 1 && !hasLoggedVoicePlayback) {
      console.log(`[AudioEngine] First voice playback (beat ${beatNumber}):`, {
        voiceGain: this.voiceGain.gain.value,
        bufferSampleRate: buf.sampleRate,
        ctxSampleRate: this.voiceCtx.sampleRate,
        ctxState: this.voiceCtx.state,
        silentAnchorRunning: this.isSilentAnchorRunning,
        activeSources: this.activeVoiceSources.size,
      });
      hasLoggedVoicePlayback = true;
    }

    try {
      const src = this.voiceCtx.createBufferSource();
      src.buffer = buf;

      // ДИАГНОСТИКА: Логируем детали только для первых 3 битов
      if (
        beatNumber <= 3 &&
        hasLoggedVoicePlayback &&
        this.activeVoiceSources.size < 3
      ) {
        console.log(`[AudioEngine] BufferSource beat ${beatNumber}:`, {
          playbackRate: src.playbackRate.value,
          detune: src.detune.value,
          loop: src.loop,
          bufferDuration: buf.duration.toFixed(3),
          scheduledAt: whenWallSec.toFixed(3),
          ctxCurrentTime: this.voiceCtx.currentTime.toFixed(3),
          activeSources: this.activeVoiceSources.size,
        });
      }

      src.connect(this.voiceGain);

      // Добавляем в активные sources для возможности остановки
      this.activeVoiceSources.add(src);

      // Автоматически удаляем после завершения
      src.onended = () => {
        this.activeVoiceSources.delete(src);
      };

      src.start(whenWallSec);
    } catch (err) {
      console.warn(
        `[AudioEngine] Failed to schedule voice ${beatNumber}:`,
        err,
      );
    }
  }

  /** Планирует удары счёта на 1.5 с вперёд. Вызов из update() даже при троттлинге вкладки даёт буфер. */
  private scheduleVoiceAhead() {
    if (
      !this.voiceCtx ||
      this.voiceBuffers.size < 8 ||
      !this.voiceGain ||
      this.beatGrid.length === 0
    ) {
      return;
    }
    const nowTrack = this.getCurrentTime();
    const nowWall = this.voiceCtx.currentTime;
    const horizon = nowTrack + AudioEngine.SCHEDULE_AHEAD_SEC;

    for (
      let i = this.lastScheduledVoiceBeatIndex + 1;
      i < this.beatGrid.length;
      i++
    ) {
      const beat = this.beatGrid[i];
      if (beat.time > horizon) break;
      if (this.shouldPlayVoiceForBeat(beat.number)) {
        this.scheduleVoiceAt(beat.number, nowWall + (beat.time - nowTrack));
      }
      this.lastScheduledVoiceBeatIndex = i;
    }
  }

  private playVoiceCount(beatNumber: number) {
    if (beatNumber < 1 || beatNumber > 8) return;
    if (!this.shouldPlayVoiceForBeat(beatNumber)) return;

    // Приоритет: Web Audio (буфер в браузере, точное время, работает в фоне)
    if (this.voiceCtx && this.voiceBuffers.has(beatNumber)) {
      this.scheduleVoiceAt(beatNumber, this.voiceCtx.currentTime);
      return;
    }

    // Запасной путь: Howl (если Web Audio не загружен)
    const voiceFile = this.voiceFiles.get(beatNumber);
    if (voiceFile) {
      voiceFile.stop();
      voiceFile.play();
    }
  }

  private startUpdate() {
    if (this.updateIntervalId !== null) return;

    // Всегда ~60fps (16ms), в т.ч. при неактивной вкладке/потушенном экране:
    // на мобильных при throttling 50ms мы чаще промахиваемся по битам и счёт молчит.
    // Музыка идёт из того же сеанса — счёт должен продолжать звенеть, пока пользователь не выключил его.
    const interval = 16;
    this.updateIntervalId = setInterval(() => this.update(), interval);
  }

  private stopUpdate() {
    if (this.updateIntervalId !== null) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }
    if (this.updateAnimationFrameId !== null) {
      cancelAnimationFrame(this.updateAnimationFrameId);
      this.updateAnimationFrameId = null;
    }
  }

  /**
   * Запускает Silent Anchor для поддержания AudioContext активным в фоне.
   * Использует тот же voiceCtx, что и Voice Counting.
   */
  startSilentAnchor() {
    if (DISABLE_SILENT_ANCHOR_TEST) {
      console.log("[AudioEngine] ⚠️ Silent Anchor DISABLED for testing");
      return;
    }

    if (this.isSilentAnchorRunning || !this.voiceCtx) {
      if (!this.voiceCtx) {
        console.warn(
          "[AudioEngine] Cannot start silent anchor: voiceCtx not initialized",
        );
      }
      return;
    }

    try {
      console.log(
        `[AudioEngine] Starting silent anchor (AudioContext state: ${this.voiceCtx.state})`,
      );

      // Resume AudioContext if suspended
      if (this.voiceCtx.state === "suspended") {
        this.voiceCtx.resume().catch((err) => {
          console.warn("[AudioEngine] Failed to resume AudioContext:", err);
        });
      }

      // Create oscillator (20Hz - below human hearing)
      this.silentOscillator = this.voiceCtx.createOscillator();
      this.silentOscillator.type = "sine";
      this.silentOscillator.frequency.value = 20;

      // Create gain (very quiet)
      this.silentGain = this.voiceCtx.createGain();
      this.silentGain.gain.value = 0.001; // 0.1% volume

      // Connect: Oscillator -> Gain -> Destination
      this.silentOscillator.connect(this.silentGain);
      this.silentGain.connect(this.voiceCtx.destination);

      // Start
      this.silentOscillator.start();
      this.isSilentAnchorRunning = true;
      console.log("[AudioEngine] Silent anchor started successfully");
    } catch (error) {
      console.warn("[AudioEngine] Failed to start silent anchor:", error);
    }
  }

  /**
   * Останавливает Silent Anchor.
   */
  stopSilentAnchor() {
    if (!this.isSilentAnchorRunning) return;

    try {
      if (this.silentOscillator) {
        this.silentOscillator.stop();
        this.silentOscillator.disconnect();
        this.silentOscillator = null;
      }

      if (this.silentGain) {
        this.silentGain.disconnect();
        this.silentGain = null;
      }

      this.isSilentAnchorRunning = false;
    } catch (error) {
      console.warn("Failed to stop silent anchor:", error);
    }
  }

  /**
   * Проверяет, запущен ли Silent Anchor.
   */
  isSilentAnchorActive(): boolean {
    return this.isSilentAnchorRunning;
  }

  destroy() {
    this.stop();
    this.stopSilentAnchor(); // Остановить Silent Anchor при уничтожении
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
