# Автоматическое определение BPM и Offset для бачаты

## Проблема

При загрузке треков нужно автоматически определять:

1. **BPM (Beats Per Minute)** - темп композиции
2. **Offset** - смещение до первого удара (downbeat) в секундах

## Что такое BPM и Offset в контексте бачаты?

### BPM (Tempo)

- **BPM** - количество ударов в минуту
- Для бачаты обычно: **120-140 BPM**
- Определяется анализом ритмического паттерна

### Offset (First Beat)

- **Offset** - время от начала трека до первого сильного удара (downbeat)
- В бачате используется **4/4 такт** (четыре удара на такт)
- Первый удар такта (downbeat) - это удар "1" в счете "1-2-3-4"
- Offset нужен для синхронизации голосового счета с музыкой

### Структура бачаты

- **Такт**: 4 удара (1-2-3-4)
- **Фраза**: обычно 8 тактов (32 удара)
- **Downbeat (удар 1)**: самый сильный удар, обычно с акцентом на бас/ударные

## Решения для определения BPM

### Вариант 1: Python библиотеки (рекомендуется)

#### librosa (Python)

```python
import librosa

# Загрузка аудио
y, sr = librosa.load('track.mp3')

# Определение BPM
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
print(f"BPM: {tempo[0]:.2f}")
```

**Плюсы:**

- ✅ Очень точное определение BPM
- ✅ Работает с MP3, WAV и другими форматами
- ✅ Можно определить позиции ударов (beats)

**Минусы:**

- ❌ Требует Python
- ❌ Нужно интегрировать с Node.js через API или child_process

#### Aubio (Python/C)

```python
import aubio

# Определение BPM
tempo_detector = aubio.tempo("default", 4096, 2048, 44100)
# ... обработка аудио
bpm = tempo_detector.get_bpm()
```

**Плюсы:**

- ✅ Быстрое и точное
- ✅ Есть C библиотека (можно использовать через FFI)

**Минусы:**

- ❌ Требует установки aubio

### Вариант 2: JavaScript/Web Audio API

#### Web Audio API + анализ частот

```javascript
// Базовый подход через Web Audio API
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
// ... анализ частот для определения ритма
```

**Плюсы:**

- ✅ Работает в браузере
- ✅ Не требует серверной обработки

**Минусы:**

- ❌ Сложная реализация
- ❌ Менее точное, чем Python библиотеки

#### Essentia.js (WebAssembly)

```javascript
import Essentia from "essentia.js";

// Определение BPM через Essentia
const bpm = Essentia.RhythmExtractor2013(audioData);
```

**Плюсы:**

- ✅ Работает в браузере
- ✅ Точное определение

**Минусы:**

- ❌ Большой размер библиотеки
- ❌ Требует компиляции WebAssembly

### Вариант 3: Интеграция с Demucs

Можно определить BPM **во время обработки** через Demucs:

- Использовать дорожку **drums** для более точного определения ритма
- Анализировать дорожку **bass** для определения downbeat

## Решения для определения Offset

### Подход 1: Анализ downbeat (первого удара такта)

```python
import librosa

y, sr = librosa.load('track.mp3')

# Определение позиций ударов
tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
beat_times = librosa.frames_to_time(beats, sr=sr)

# Определение downbeat (первого удара такта)
# В бачате это обычно удар с акцентом на бас/ударные
downbeats = librosa.onset.onset_detect(y=y, sr=sr)
first_downbeat = downbeats[0] if len(downbeats) > 0 else 0

offset = first_downbeat / sr  # в секундах
```

### Подход 2: Анализ энергетики (energy-based)

```python
import librosa
import numpy as np

y, sr = librosa.load('track.mp3')

# Вычисление энергетики сигнала
energy = np.abs(librosa.stft(y))
energy_sum = np.sum(energy, axis=0)

# Находим первый пик (первый сильный удар)
peaks = librosa.util.peak_pick(energy_sum, pre_max=3, post_max=3,
                                pre_avg=3, post_avg=5, delta=0.7, wait=10)
first_peak = peaks[0] if len(peaks) > 0 else 0

offset = librosa.frames_to_time(first_peak, sr=sr)
```

### Подход 3: Анализ дорожки drums (после Demucs)

После разделения на дорожки через Demucs:

1. Используем дорожку **drums** для анализа
2. Находим первый сильный удар (kick drum)
3. Это и будет offset

```python
import librosa

# Анализируем дорожку drums
drums, sr = librosa.load('drums.mp3')

# Находим первый сильный удар
onset_frames = librosa.onset.onset_detect(y=drums, sr=sr,
                                          units='time',
                                          backtrack=True)
offset = onset_frames[0] if len(onset_frames) > 0 else 0
```

## Рекомендуемая реализация

### Этап 1: Интеграция с Demucs (во время обработки)

1. После разделения на дорожки через Demucs
2. Анализируем дорожку **drums.mp3** для определения:
   - BPM (через librosa.beat.beat_track)
   - Offset (первый сильный удар)

### Этап 2: Python скрипт для анализа

Создать скрипт `scripts/analyze-bpm-offset.py`:

```python
import librosa
import sys
import json

def analyze_track(audio_path):
    """Анализирует трек и определяет BPM и Offset"""
    y, sr = librosa.load(audio_path)

    # Определение BPM
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    bpm = round(float(tempo[0]))

    # Определение Offset (первый downbeat)
    # Используем анализ энергетики для нахождения первого сильного удара
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units='time')
    offset = round(onset_frames[0], 3) if len(onset_frames) > 0 else 0.0

    return {
        'bpm': bpm,
        'offset': offset
    }

if __name__ == '__main__':
    audio_path = sys.argv[1]
    result = analyze_track(audio_path)
    print(json.dumps(result))
```

### Этап 3: Интеграция в API route

Обновить `/api/process-track/route.ts`:

1. После обработки через Demucs
2. Запустить Python скрипт для анализа BPM и Offset
3. Сохранить результаты в БД

## Установка зависимостей

```bash
# В venv
pip install librosa soundfile
```

## Точность определения

- **BPM**: Обычно точность ±1-2 BPM (достаточно для бачаты)
- **Offset**: Точность ±0.1-0.2 секунды (может потребоваться ручная корректировка)

## Ручная корректировка

После автоматического определения можно:

1. Прослушать трек
2. Проверить, совпадает ли счет с музыкой
3. При необходимости скорректировать Offset вручную через админ-панель

## Следующие шаги

1. ✅ Создать Python скрипт для анализа BPM и Offset
2. ✅ Интегрировать в процесс обработки через Demucs
3. ✅ Добавить возможность ручной корректировки в админ-панели
4. ⏳ Тестирование на реальных треках бачаты
