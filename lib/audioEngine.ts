import { Howl } from "howler";
import type { Track, VoiceFilter } from "@/types";

interface StemsTracks {
  vocals: Howl | null;
  drums: Howl | null;
  bass: Howl | null;
  other: Howl | null;
}

export class AudioEngine {
  // Для необработанных треков - один трек
  private musicTrack: Howl | null = null;
  // Для обработанных треков - отдельные дорожки
  private stemsTracks: StemsTracks = {
    vocals: null,
    drums: null,
    bass: null,
    other: null,
  };
  private voiceSamples: Howl[] | null = null;

  private currentTrack: Track | null = null;
  private voiceFilter: VoiceFilter = "on1and5";
  private musicVolume: number = 100;
  private voiceVolume: number = 100;
  
  // Управление дорожками
  private stemsEnabled = {
    vocals: true,
    drums: true,
    bass: true,
    other: true,
  };
  private stemsVolume = {
    vocals: 100,
    drums: 100,
    bass: 100,
    other: 100,
  };
  
  private beatInterval: number = 0;
  private nextBeatTime: number = 0;
  private currentBeat: number = 0;
  private animationFrameId: number | null = null;
  private onBeatChange: ((beat: number) => void) | null = null;
  private onTrackEnd: (() => void) | null = null;
  private isPageVisible: boolean = true;
  private visibilityHandler: (() => void) | null = null;

  constructor() {
    this.loadVoiceSamples();
    this.setupVisibilityHandling();
  }

  private setupVisibilityHandling() {
    // Обработка видимости страницы для предотвращения "залипания" при переключении вкладок
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        const wasVisible = this.isPageVisible;
        this.isPageVisible = !document.hidden;

        // Если страница снова стала видимой, пересчитываем синхронизацию
        const hasTrack = this.musicTrack || Object.values(this.stemsTracks).some(t => t !== null);
        if (!wasVisible && this.isPageVisible && hasTrack && this.currentTrack) {
          this.resyncBeatTracking();
        }
      };

      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private loadVoiceSamples() {
    // Загружаем голосовые сэмплы с обработкой ошибок
    // Все файлы используют единый формат: 1.mp3, 2.mp3, 3.mp3, 4.mp3, 5.mp3, 6.mp3, 7.mp3, 8.mp3
    try {
      this.voiceSamples = Array.from({ length: 8 }, (_, i) => {
        return new Howl({
          src: [`/audio/voice/${i + 1}.mp3`],
          preload: true,
          volume: this.voiceVolume / 100, // Устанавливаем громкость сразу
          onload: () => {
            console.log(`✅ Voice sample ${i + 1}.mp3 loaded`);
          },
          onloaderror: (id, error) => {
            console.warn(`❌ Failed to load voice sample: ${i + 1}.mp3`, error);
          },
        });
      });
    } catch (error) {
      console.error("Error loading voice samples:", error);
    }
  }

  loadTrack(track: Track) {
    // Останавливаем и выгружаем текущие треки
    this.unloadCurrentTracks();

    this.currentTrack = track;
    this.beatInterval = 60 / track.bpm; // интервал между ударами в секундах
    this.nextBeatTime = track.offset;
    this.currentBeat = 0;

    // Если трек обработан и есть отдельные дорожки, загружаем их
    if (track.isProcessed && track.pathVocals && track.pathDrums && track.pathBass && track.pathOther) {
      console.log(`Loading processed track with stems: ${track.title}`);
      this.loadStemsTracks(track);
    } else {
      // Загружаем обычный трек
      const audioPath = track.isProcessed && track.pathOriginal 
        ? track.pathOriginal 
        : `/music/${track.filename}`;

      console.log(`Loading track: ${track.title}, path: ${audioPath}`);

      this.musicTrack = new Howl({
        src: [audioPath],
        html5: true,
        preload: true,
        volume: this.musicVolume / 100,
        onload: () => {
          console.log("Track loaded successfully:", audioPath);
        },
        onloaderror: (id, error) => {
          console.error("Failed to load track:", audioPath, error);
        },
        onend: () => {
          if (this.onTrackEnd) {
            this.onTrackEnd();
          }
        },
      });
    }
  }

  private loadStemsTracks(track: Track) {
    // Загружаем каждую дорожку отдельно
    const loadStem = (path: string | null, key: keyof StemsTracks) => {
      if (!path) return null;

      return new Howl({
        src: [path],
        html5: true,
        preload: true,
        volume: (this.stemsVolume[key] / 100) * (this.stemsEnabled[key] ? 1 : 0),
        onload: () => {
          console.log(`✅ Stem ${key} loaded: ${path}`);
        },
        onloaderror: (id, error) => {
          console.error(`❌ Failed to load stem ${key}:`, path, error);
        },
        onend: () => {
          // Проверяем, закончились ли все дорожки
          const allEnded = Object.values(this.stemsTracks).every(
            (t) => !t || !t.playing()
          );
          if (allEnded && this.onTrackEnd) {
            this.onTrackEnd();
          }
        },
      });
    };

    this.stemsTracks.vocals = loadStem(track.pathVocals, 'vocals');
    this.stemsTracks.drums = loadStem(track.pathDrums, 'drums');
    this.stemsTracks.bass = loadStem(track.pathBass, 'bass');
    this.stemsTracks.other = loadStem(track.pathOther, 'other');
  }

  private unloadCurrentTracks() {
    // Останавливаем и выгружаем обычный трек
    if (this.musicTrack) {
      this.musicTrack.stop();
      this.musicTrack.unload();
      this.musicTrack = null;
    }

    // Останавливаем и выгружаем дорожки
    Object.entries(this.stemsTracks).forEach(([key, track]) => {
      if (track) {
        track.stop();
        track.unload();
        this.stemsTracks[key as keyof StemsTracks] = null;
      }
    });
  }

  play() {
    if (!this.currentTrack) {
      console.warn('AudioEngine.play(): No current track')
      return;
    }

    console.log('AudioEngine.play() called', {
      hasMusicTrack: !!this.musicTrack,
      hasStems: Object.values(this.stemsTracks).some(t => t !== null)
    });

    // Воспроизводим либо обычный трек, либо дорожки
    if (this.musicTrack) {
      console.log('Playing musicTrack')
      this.musicTrack.play();
    } else {
      // Воспроизводим все включенные дорожки синхронно
      console.log('Playing stems tracks')
      Object.entries(this.stemsTracks).forEach(([key, track]) => {
        if (track && this.stemsEnabled[key as keyof StemsTracks]) {
          console.log(`Playing stem: ${key}`)
          track.play();
        }
      });
    }

    this.startBeatTracking();
  }

  pause() {
    if (this.musicTrack) {
      this.musicTrack.pause();
    } else {
      // Пауза всех дорожек
      Object.values(this.stemsTracks).forEach((track) => {
        if (track) {
          track.pause();
        }
      });
    }
    this.stopBeatTracking();
  }

  stop() {
    if (this.musicTrack) {
      this.musicTrack.stop();
    } else {
      // Останавливаем все дорожки
      Object.values(this.stemsTracks).forEach((track) => {
        if (track) {
          track.stop();
        }
      });
    }
    this.stopBeatTracking();
    this.currentBeat = 0;
    this.nextBeatTime = this.currentTrack?.offset || 0;
  }

  setMusicVolume(volume: number) {
    this.musicVolume = volume;
    if (this.musicTrack) {
      this.musicTrack.volume(volume / 100);
    }
  }

  setStemsEnabled(stems: Partial<typeof this.stemsEnabled>) {
    this.stemsEnabled = { ...this.stemsEnabled, ...stems };
    
    // Обновляем громкость дорожек (0 если выключена)
    Object.entries(stems).forEach(([key, enabled]) => {
      const stemKey = key as keyof StemsTracks;
      const track = this.stemsTracks[stemKey];
      if (track) {
        const volume = enabled ? this.stemsVolume[stemKey] / 100 : 0;
        track.volume(volume);
      }
    });
  }

  setStemsVolume(stems: Partial<typeof this.stemsVolume>) {
    this.stemsVolume = { ...this.stemsVolume, ...stems };
    
    // Обновляем громкость дорожек
    Object.entries(stems).forEach(([key, volume]) => {
      const stemKey = key as keyof StemsTracks;
      const track = this.stemsTracks[stemKey];
      if (track && this.stemsEnabled[stemKey]) {
        track.volume(volume / 100);
      }
    });
  }

  setVoiceVolume(volume: number) {
    this.voiceVolume = volume;
    // Обновляем громкость всех голосовых сэмплов
    if (this.voiceSamples) {
      this.voiceSamples.forEach((sample) => {
        sample.volume(volume / 100);
      });
    }
  }

  setVoiceFilter(filter: VoiceFilter) {
    this.voiceFilter = filter;
  }

  setOnBeatChange(callback: (beat: number) => void) {
    this.onBeatChange = callback;
  }

  setOnTrackEnd(callback: () => void) {
    this.onTrackEnd = callback;
  }

  getCurrentTime(): number {
    if (this.musicTrack) {
      return this.musicTrack.seek() as number;
    }
    
    // Для дорожек берем время первой активной дорожки
    for (const track of Object.values(this.stemsTracks)) {
      if (track && track.playing()) {
        return track.seek() as number;
      }
    }
    
    // Если ничего не играет, берем время первой доступной дорожки
    for (const track of Object.values(this.stemsTracks)) {
      if (track) {
        return track.seek() as number;
      }
    }
    
    return 0;
  }

  getDuration(): number {
    if (this.musicTrack) {
      return this.musicTrack.duration();
    }
    
    // Для дорожек берем длительность первой доступной дорожки
    for (const track of Object.values(this.stemsTracks)) {
      if (track) {
        return track.duration();
      }
    }
    
    return 0;
  }

  seek(time: number) {
    if (this.musicTrack) {
      this.musicTrack.seek(time);
    } else {
      // Синхронизируем seek для всех дорожек
      Object.values(this.stemsTracks).forEach((track) => {
        if (track) {
          track.seek(time);
        }
      });
    }
    
    // Пересчитываем синхронизацию при seek
    if (this.currentTrack) {
      this.resyncBeatTracking();
    }
  }

  private startBeatTracking() {
    if (this.animationFrameId !== null) return;

    const track = () => {
      const hasTrack = this.musicTrack || Object.values(this.stemsTracks).some(t => t !== null);
      if (!hasTrack || !this.currentTrack) {
        this.animationFrameId = null;
        return;
      }

      const currentTime = this.getCurrentTime();

      // Проверяем, наступил ли следующий удар
      // Если пропущено много времени (например, при возврате на вкладку),
      // пересчитываем синхронизацию вместо попытки "нагнать" все пропущенные удары
      const timeUntilNextBeat = this.nextBeatTime - currentTime;
      
      if (timeUntilNextBeat < -this.beatInterval * 2) {
        // Пропущено более 2 ударов - пересчитываем синхронизацию
        this.resyncBeatTracking();
      } else if (currentTime >= this.nextBeatTime) {
        // Обычный переход к следующему удару
        this.currentBeat = (this.currentBeat + 1) % 8;
        this.nextBeatTime += this.beatInterval;

        // Уведомляем о смене удара (только если страница видна, чтобы не обновлять UI в фоне)
        if (this.isPageVisible && this.onBeatChange) {
          this.onBeatChange(this.currentBeat);
        }

        // Воспроизводим голосовой сэмпл в зависимости от режима (всегда, даже если вкладка неактивна)
        this.playVoiceSample(this.currentBeat);
      }

      this.animationFrameId = requestAnimationFrame(track);
    };

    this.animationFrameId = requestAnimationFrame(track);
  }

  /**
   * Пересчитывает синхронизацию ударов на основе текущего времени трека
   * Используется при возврате на вкладку или после seek
   */
  private resyncBeatTracking() {
    const hasTrack = this.musicTrack || Object.values(this.stemsTracks).some(t => t !== null);
    if (!hasTrack || !this.currentTrack) return;

    const currentTime = this.getCurrentTime();
    
    // Вычисляем, сколько ударов прошло с начала трека
    const beatsPassed = Math.floor(
      (currentTime - this.currentTrack.offset) / this.beatInterval
    );
    
    // Устанавливаем текущий удар (0-7)
    this.currentBeat = beatsPassed % 8;
    
    // Вычисляем время следующего удара
    this.nextBeatTime = 
      this.currentTrack.offset + (beatsPassed + 1) * this.beatInterval;

    // Сразу обновляем визуализацию
    if (this.onBeatChange) {
      this.onBeatChange(this.currentBeat);
    }
  }

  private stopBeatTracking() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private playVoiceSample(beat: number) {
    if (this.voiceFilter === "mute" || !this.voiceSamples) return;

    const beatNumber = beat + 1; // beat 0-7 -> 1-8
    const beatIndex = beat; // индекс в массиве: 0-7

    let sampleToPlay: Howl | null = null;

    if (this.voiceFilter === "on1" && beatNumber === 1) {
      // Воспроизводим файл 1.mp3 (индекс 0)
      sampleToPlay = this.voiceSamples[0];
    } else if (
      this.voiceFilter === "on1and5" &&
      (beatNumber === 1 || beatNumber === 5)
    ) {
      if (beatNumber === 1) {
        // Воспроизводим файл 1.mp3 (индекс 0)
        sampleToPlay = this.voiceSamples[0];
      } else {
        // Воспроизводим файл 5.mp3 (индекс 4)
        sampleToPlay = this.voiceSamples[4];
      }
    } else if (this.voiceFilter === "full") {
      // Воспроизводим соответствующий файл для каждого удара
      sampleToPlay = this.voiceSamples[beatIndex];
    }

    if (sampleToPlay) {
      try {
        // Останавливаем предыдущее воспроизведение этого сэмпла (если играет)
        sampleToPlay.stop();
        // Воспроизводим с текущей громкостью
        sampleToPlay.volume(this.voiceVolume / 100);
        sampleToPlay.play();
      } catch (error) {
        console.warn("Error playing voice sample:", error);
      }
    }
  }

  destroy() {
    this.stop();
    this.unloadCurrentTracks();
    
    // Unload voice samples
    if (this.voiceSamples) {
      this.voiceSamples.forEach((sample) => sample.unload());
    }
    
    // Удаляем обработчик видимости страницы
    if (typeof document !== 'undefined' && this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}
