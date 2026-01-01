# Обзор системы: Bachata Beat Counter

## 1. Описание проекта

**Bachata Beat Counter** — веб-приложение для танцоров бачаты, которое воспроизводит музыку и накладывает поверх неё голосовой счет (ритм). Приложение позволяет:

- Воспроизводить музыкальные треки с визуализацией ритма (1-8)
- Автоматически определять BPM и Offset треков
- Разделять треки на стемы (vocals, drums, bass, other) с помощью Demucs
- Управлять громкостью отдельных дорожек
- Настраивать режимы счета (mute, on1, on1and5, full)
- Управлять плейлистом с фильтрацией и поиском

## 2. Технологический стек

### Frontend

- **Next.js 15.1.0** (App Router) — React-фреймворк с серверным рендерингом
- **React 18.3.1** — UI библиотека
- **TypeScript 5.6.0** — строгая типизация
- **Tailwind CSS 3.4.0** — utility-first CSS фреймворк
- **PostCSS 8.4.0** + **Autoprefixer 10.4.0** — обработка CSS

### State Management

- **Zustand 4.5.0** — легковесный state manager
  - Управление состоянием плеера (currentTrack, isPlaying, volume и т.д.)
  - Персистентность через localStorage
  - Синхронизация с AudioEngine

### Audio Processing

- **Howler.js 2.2.4** — Web Audio API библиотека
  - Воспроизведение аудио в браузере
  - Управление громкостью, пауза, перемотка
  - Поддержка множественных аудио-источников
- **Demucs** (Python) — разделение аудио на стемы
  - Модель: htdemucs (4 стема: vocals, drums, bass, other)
  - Формат вывода: MP3
  - Параметры: `--shifts 5` (для лучшего качества)
- **librosa** (Python) — анализ аудио
  - Автоматическое определение BPM
  - Автоматическое определение Offset (первого бита)

### Backend

- **Next.js API Routes** — серверные эндпоинты
  - `/api/tracks` — получение списка треков
  - `/api/process-track` — загрузка и обработка треков
- **Prisma 5.19.0** — ORM для работы с БД
- **MySQL** — реляционная база данных

### Development Tools

- **tsx 4.7.0** — выполнение TypeScript файлов
- **ESLint 9.0.0** — линтер кода
- **TypeScript** — компилятор и типизация

## 3. Архитектура приложения

### Структура проекта

```
bachata/
├── app/                    # Next.js App Router
│   ├── (main)/            # Группа маршрутов с общим layout
│   │   ├── page.tsx       # Главная страница воспроизведения
│   │   ├── library/       # Страница медиатеки
│   │   └── layout.tsx     # Layout с Sidebar
│   ├── admin/             # Админ-панель
│   │   └── upload/        # Загрузка треков
│   ├── api/               # API Routes
│   │   ├── tracks/        # GET /api/tracks
│   │   └── process-track/ # POST /api/process-track
│   └── layout.tsx         # Root layout
├── components/             # React компоненты
│   ├── BeatCounter.tsx    # Визуализация счета (1-8)
│   ├── PlayerControls.tsx # Кнопки управления (play/pause, progress, volume)
│   ├── Playlist.tsx       # Список треков с фильтрацией
│   ├── SettingsPanel.tsx  # Настройки (playMode, voiceFilter)
│   ├── Sidebar.tsx        # Боковое меню навигации
│   ├── StemsControl.tsx   # Управление стемами (громкость дорожек)
│   └── TrackInfo.tsx      # Информация о треке (title, artist, BPM, Offset)
├── lib/                   # Утилиты и бизнес-логика
│   ├── audioEngine.ts     # Класс AudioEngine (управление Howler.js)
│   ├── demucs.ts          # Интеграция с Demucs
│   ├── analyzeAudio.ts    # Интеграция с librosa для BPM/Offset
│   └── prisma.ts          # Prisma Client
├── store/                 # Zustand stores
│   └── playerStore.ts     # Главный store для плеера
├── types/                 # TypeScript типы
│   └── index.ts           # Интерфейсы Track, PlayerState и т.д.
├── prisma/                # Prisma схема
│   └── schema.prisma      # Модели БД
├── scripts/               # Утилитарные скрипты
│   ├── analyze-bpm-offset.py  # Python скрипт для анализа BPM/Offset
│   ├── check-db.ts        # Проверка подключения к БД
│   ├── check-demucs.ts    # Проверка установки Demucs
│   └── clear-tracks.ts    # Очистка БД и файлов
├── public/                # Статические файлы
│   ├── audio/voice/       # Голосовые сэмплы (1.mp3 - 10.mp3)
│   ├── uploads/           # Загруженные треки
│   │   ├── raw/           # Оригинальные файлы
│   │   └── stems/         # Разделенные стемы (htdemucs/{uuid}/)
│   └── music/             # Статические треки (legacy)
└── docs/                  # Документация
```

### Поток данных

1. **Загрузка и обработка треков:**

   **Шаг 1: Переход на страницу Медиатеки**

   - Пользователь переходит на `/library` (Медиатека)
   - Отображается форма загрузки трека

   **Шаг 2: Заполнение формы**

   - Выбор MP3 файла (максимум 100MB)
   - Ввод названия трека (обязательно)
   - Ввод исполнителя (опционально)
   - Настройка BPM и Offset:
     - Опция "Определить автоматически" (по умолчанию включена)
     - Или ручной ввод значений
   - Нажатие кнопки "Загрузить и обработать"

   **Шаг 3: Отправка на сервер**

   - Форма отправляется через `POST /api/process-track`
   - Данные передаются как `FormData`:
     - `file: File` — MP3 файл
     - `title: string` — название трека
     - `artist?: string` — исполнитель (опционально)
     - `bpm?: string` — BPM (только если не auto)
     - `offset?: string` — Offset (только если не auto)
     - `autoBpm: 'true' | 'false'` — флаг автоматического определения BPM
     - `autoOffset: 'true' | 'false'` — флаг автоматического определения Offset

   **Шаг 4: Обработка на сервере (`/api/process-track`)**

   **4.1. Валидация:**

   - Проверка наличия файла и названия
   - Проверка типа файла (только MP3)
   - Проверка размера файла (максимум 100MB)

   **4.2. Сохранение файла:**

   - Генерация уникального UUID для трека
   - Создание директорий `public/uploads/raw/` и `public/uploads/stems/` (если не существуют)
   - Сохранение файла в `public/uploads/raw/{uuid}.mp3`

   **4.3. Разделение на стемы (Demucs):**

   - Запуск Demucs для разделения аудио на 4 дорожки:
     - `vocals.mp3` — вокал
     - `drums.mp3` — ударные
     - `bass.mp3` — бас
     - `other.mp3` — остальное
   - Стемы сохраняются в `public/uploads/stems/htdemucs/{uuid}/`
   - Формат: MP3, параметры: `--shifts 5` (для лучшего качества)

   **4.4. Анализ аудио (madmom + librosa):**

   - **ВСЕГДА** запускается анализ для получения `gridMap` (даже если BPM/Offset введены вручную)
   - Используется Python скрипт `scripts/analyze-track.py` с библиотекой `madmom`
   - Анализ определяет:
     - BPM (ударов в минуту)
     - Offset (смещение первого бита в секундах)
     - GridMap (карта битов с секциями verse/bridge для корректного отслеживания ритма)
   - Если `autoBpm === true`: используется BPM из анализа, иначе используется введенное значение
   - Если `autoOffset === true`: используется Offset из анализа, иначе используется введенное значение
   - Значения сохраняются как `baseBpm` и `baseOffset` для возможности сброса к оригинальным

   **4.5. Сохранение в базу данных:**

   - Создание записи в MySQL через Prisma ORM
   - Сохранение всех данных трека:
     - Метаданные: `title`, `artist`, `filename` (UUID)
     - Параметры: `bpm`, `offset`, `baseBpm`, `baseOffset`
     - Пути к файлам: `pathOriginal`, `pathVocals`, `pathDrums`, `pathBass`, `pathOther`
     - Флаги: `isProcessed: true`, `isFree: true`
     - GridMap: JSON структура с секциями (verse/bridge)

   **Шаг 5: Завершение загрузки**

   - API возвращает успешный ответ с данными трека
   - На странице отображается сообщение об успехе
   - Через 2 секунды происходит автоматический редирект на главную страницу (`/`)

2. **Загрузка треков в плеер:**

   **Шаг 1: Инициализация главной страницы (`/`)**

   - При монтировании компонента выполняется `useEffect`
   - Запрос к `/api/tracks` для получения списка всех треков из БД
   - Треки сохраняются в Zustand store через `setTracks(tracks)`

   **Шаг 2: Восстановление сохраненного трека**

   - Проверка `localStorage` на наличие `savedTrackId`
   - Если сохраненный трек найден в списке — загружается он
   - Если сохраненный трек не найден — загружается первый трек из списка
   - Если треков нет — плеер остается пустым

   **Шаг 3: Загрузка трека в AudioEngine**

   - Вызывается `store.loadTrack(track)` (который вызывает `setCurrentTrack`)
   - `setCurrentTrack` выполняет:
     1. Немедленный сброс состояния: `currentTime: 0`, `duration: 0`
     2. Остановку текущего воспроизведения: `audioEngine.stop()`
     3. Загрузку трека: `audioEngine.loadTrack(track, isStemsMode, stemsEnabled, stemsVolume)`
     4. Установку громкости: `audioEngine.setMusicVolume(musicVolume)`
   - AudioEngine определяет режим воспроизведения:
     - **Full File Mode** (по умолчанию): загружается один Howl-инстанс для `pathOriginal`
     - **Stems Mode** (если `isStemsMode === true` и `track.isProcessed === true`): загружаются 4 Howl-инстанса для стемов

   **Шаг 4: Отображение в UI**

   - Треки отображаются в компоненте `Playlist`
   - Активный трек выделяется в списке
   - Информация о треке показывается в `TrackInfo`
   - Управление воспроизведением через `PlayerControls`
   - Для обработанных треков доступен `StemsControl` для управления дорожками

3. **Воспроизведение:**

   - Состояние управляется через Zustand store
   - AudioEngine (Howler.js) воспроизводит аудио
   - Beat tracking синхронизируется с BPM, Offset и GridMap (если доступен)
   - Голосовые сэмплы накладываются согласно voiceFilter (если включен)
   - При окончании трека автоматически вызывается `playNext()`

4. **Управление состоянием:**
   - Zustand store синхронизирует UI и AudioEngine
   - Изменения громкости, режимов автоматически применяются к AudioEngine
   - Состояние сохраняется в localStorage (только `savedTrackId`)

## 4. Основные компоненты

### AudioEngine (`lib/audioEngine.ts`)

Класс для управления аудио через Howler.js:

**Основные возможности:**

- Загрузка треков (обычных или разделенных на стемы)
- Управление воспроизведением (play, pause, stop, seek)
- Управление громкостью (master music volume, voice volume, individual stems)
- Beat tracking — отслеживание ритма на основе BPM и Offset
- Voice samples — воспроизведение голосовых сэмплов (1-8) согласно voiceFilter
- Page visibility handling — корректная работа при переключении вкладок

**Ключевые методы:**

- `loadTrack(track: Track)` — загрузка трека
- `play()`, `pause()`, `stop()` — управление воспроизведением
- `setMusicVolume(volume: number)` — громкость музыки (0-100)
- `setVoiceVolume(volume: number)` — громкость голоса (0-100, умножается на 3)
- `setStemsEnabled(stems: Partial<StemsTracks>)` — включение/выключение дорожек
- `setStemsVolume(stems: Partial<StemsVolume>)` — громкость отдельных дорожек
- `setVoiceFilter(filter: VoiceFilter)` — режим счета
- `updateBpm(bpm: number)`, `updateOffset(offset: number)` — динамическое изменение параметров

### PlayerStore (`store/playerStore.ts`)

Zustand store для управления состоянием плеера:

**Состояние:**

- `currentTrack: Track | null` — текущий трек
- `tracks: Track[]` — список всех треков
- `isPlaying: boolean` — статус воспроизведения
- `currentTime: number`, `duration: number` — позиция и длительность
- `musicVolume: number`, `voiceVolume: number` — громкости
- `stemsEnabled`, `stemsVolume` — управление дорожками
- `playMode: 'sequential' | 'random' | 'loop'` — режим воспроизведения
- `voiceFilter: 'mute' | 'on1' | 'on1and5' | 'full'` — режим счета
- `audioEngine: AudioEngine | null` — ссылка на AudioEngine

**Методы:**

- `setCurrentTrack(track)` — устанавливает трек и автоматически загружает в AudioEngine
- `play()`, `pause()`, `stop()` — управление воспроизведением (синхронизируют Zustand и AudioEngine)
- `loadTrack(track)` — загрузка трека с синхронизацией всех настроек
- `playNext()`, `playPrevious()` — переключение треков с учетом фильтров

### Компоненты UI

**BeatCounter** — визуализация счета (1-8):

- Отображает текущий бит с анимацией (scale, bold, color)
- Обновляется через callback из AudioEngine

**PlayerControls** — управление воспроизведением:

- Кнопка Play/Pause
- Progress bar с возможностью перемотки
- Слайдеры громкости (Music, Voice)

**TrackInfo** — информация о треке:

- Название, исполнитель
- BPM и Offset (редактируемые)
- Кнопка "Reset" для возврата к базовым значениям

**StemsControl** — управление дорожками:

- Включение/выключение дорожек (vocals, drums, bass, other)
- Индивидуальная громкость каждой дорожки

**Playlist** — список треков:

- Фильтрация (free, my, all)
- Поиск по названию/исполнителю
- Выделение активного трека
- Автопрокрутка к активному треку

## 5. Структура данных

### Track (Prisma Schema)

```prisma
model Track {
  id          Int      @id @default(autoincrement())
  title       String
  artist      String?
  filename    String
  bpm         Int      // Текущее BPM (может быть изменено пользователем)
  offset      Float    // Текущий Offset (может быть изменен пользователем)
  baseBpm     Int?     // Базовое BPM (определено автоматически)
  baseOffset  Float?   // Базовый Offset (определен автоматически)
  isFree      Boolean  @default(true)
  createdAt   DateTime @default(now())

  // Пути к файлам Demucs
  pathOriginal String?  // /uploads/raw/{uuid}.mp3
  pathVocals   String?  // /uploads/stems/htdemucs/{uuid}/vocals.mp3
  pathDrums    String?  // /uploads/stems/htdemucs/{uuid}/drums.mp3
  pathBass     String?  // /uploads/stems/htdemucs/{uuid}/bass.mp3
  pathOther    String?  // /uploads/stems/htdemucs/{uuid}/other.mp3
  isProcessed  Boolean @default(false)  // Всегда true после обработки (Demucs всегда запускается)
  gridMap      Json?    // Карта битов с секциями verse/bridge от madmom анализа
}
```

**Особенности:**

- Уникальный UUID используется для имен файлов (даже при одинаковых названиях)
- `baseBpm` и `baseOffset` хранят оригинальные значения (автоматически определенные или введенные вручную) для возможности сброса
- `isProcessed` всегда `true` после обработки (Demucs всегда запускается при загрузке)
- `gridMap` содержит карту битов с секциями verse/bridge от madmom анализа (если анализ успешен)
- Если `gridMap` отсутствует, используется линейный beat tracking на основе BPM/Offset

### PlayerState (TypeScript)

```typescript
interface PlayerState {
  currentTrack: Track | null;
  tracks: Track[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  musicVolume: number; // 0-100
  voiceVolume: number; // 0-100
  stemsEnabled: { vocals; drums; bass; other: boolean };
  stemsVolume: { vocals; drums; bass; other: number }; // 0-100
  playMode: "sequential" | "random" | "loop";
  voiceFilter: "mute" | "on1" | "on1and5" | "full";
  audioEngine: AudioEngine | null;
  // ... методы
}
```

## 6. API Endpoints

### GET `/api/tracks`

Возвращает список всех треков из БД.

**Response:**

```json
[
  {
    "id": 1,
    "title": "Stuck On You",
    "artist": "Prince Royce",
    "bpm": 123,
    "offset": 0.5,
    "isProcessed": true,
    "pathOriginal": "/uploads/raw/uuid.mp3",
    "pathVocals": "/uploads/stems/htdemucs/uuid/vocals.mp3"
    // ...
  }
]
```

### POST `/api/process-track`

Загружает и обрабатывает трек.

**Request (FormData):**

- `file: File` — MP3 файл
- `title: string` — название трека
- `artist?: string` — исполнитель
- `bpm?: string` — BPM (если не auto)
- `offset?: string` — Offset (если не auto)
- `autoBpm: 'true' | 'false'` — автоматическое определение BPM
- `autoOffset: 'true' | 'false'` — автоматическое определение Offset

**Response:**

```json
{
  "success": true,
  "track": {
    /* Track object */
  },
  "message": "Track processed successfully"
}
```

**Процесс обработки (детально):**

1. **Валидация:**

   - Проверка наличия файла и названия
   - Проверка типа файла (только MP3)
   - Проверка размера (максимум 100MB)

2. **Сохранение файла:**

   - Генерация UUID для уникальности
   - Создание директорий `public/uploads/raw/` и `public/uploads/stems/` (если не существуют)
   - Сохранение в `public/uploads/raw/{uuid}.mp3`

3. **Разделение на стемы (Demucs):**

   - Запуск `python -m demucs.separate` с параметрами `--shifts 5 --mp3`
   - Вход: `public/uploads/raw/{uuid}.mp3`
   - Выход: `public/uploads/stems/htdemucs/{uuid}/` (4 файла: vocals, drums, bass, other)

4. **Анализ аудио (madmom + librosa):**

   - **ВСЕГДА** запускается анализ для получения `gridMap` (даже если BPM/Offset введены вручную)
   - Используется Python скрипт `scripts/analyze-track.py` с библиотекой `madmom`
   - Определяет:
     - BPM (если `autoBpm === true`, иначе используется введенное значение)
     - Offset (если `autoOffset === true`, иначе используется введенное значение)
     - GridMap (карта битов с секциями verse/bridge) — **всегда определяется**
   - Значения сохраняются как `baseBpm` и `baseOffset` для возможности сброса

5. **Сохранение в БД:**
   - Создание записи через Prisma ORM
   - Сохранение всех путей к файлам, метаданных, параметров и GridMap
   - Установка `isProcessed: true` (всегда, так как Demucs всегда запускается)

## 7. Работа с аудио

### Beat Tracking

**Алгоритм:**

1. На основе `track.bpm` вычисляется `beatInterval = 60 / bpm` (секунды)
2. Первый бит начинается в момент `track.offset`
3. Используется `requestAnimationFrame` для точного отслеживания времени
4. При достижении `nextBeatTime` обновляется `currentBeat` (0-7, циклически)
5. Воспроизводится голосовой сэмпл согласно `voiceFilter`

**Voice Filter:**

- `mute` — голос не воспроизводится
- `on1` — только на бит 0 (первая доля)
- `on1and5` — на биты 0 и 4 (первая и пятая доли)
- `full` — на все биты (0-7)

### Stems Management

Для обработанных треков (`isProcessed === true`):

- Загружаются 4 отдельных файла (vocals, drums, bass, other)
- Каждая дорожка — отдельный `Howl` инстанс
- Громкость вычисляется: `masterVolume * stemVolume * (enabled ? 1 : 0)`
- Все дорожки синхронизированы для одновременного воспроизведения

### Volume Control

**Master Music Volume:**

- Применяется ко всем дорожкам (если трек обработан)
- Или к единственному треку (если не обработан)

**Voice Volume:**

- Умножается на 3 для увеличения громкости (ограничено до 1.0 для Howler)
- Применяется ко всем голосовым сэмплам

**Stems Volume:**

- Индивидуальная громкость каждой дорожки (0-100%)
- Учитывается при вычислении финальной громкости

## 8. Интеграции

### Demucs (Python)

**Установка:**

```bash
pip install demucs
```

**Использование:**

- Команда: `python -m demucs.separate`
- Параметры: `--shifts 5 --mp3`
- Вход: `public/uploads/raw/{uuid}.mp3`
- Выход: `public/uploads/stems/htdemucs/{uuid}/`

**Модель:** htdemucs (4 стема: vocals, drums, bass, other)

### madmom + librosa (Python)

**Установка:**

```bash
pip install madmom librosa soundfile numpy
```

**Использование:**

- **Основной скрипт:** `scripts/analyze-track.py` (используется по умолчанию)
  - Использует `madmom` для определения GridMap (карта битов с секциями verse/bridge)
  - Использует `librosa` для определения BPM и Offset
  - Возвращает полный анализ: BPM, Offset и GridMap
- **Устаревший скрипт:** `scripts/analyze-bpm-offset.py` (deprecated)
  - Использовался только для BPM и Offset
  - Не определяет GridMap
  - Оставлен для совместимости

**Важно:**

- Анализ **ВСЕГДА** запускается для получения GridMap (даже если BPM/Offset введены вручную)
- GridMap необходим для корректного отслеживания битов с учетом мостиков (bridge sections)
- Если анализ не удался, используется линейный beat tracking на основе BPM/Offset

## 9. Особенности реализации

### Синхронизация Zustand и AudioEngine

- Все изменения состояния (volume, stems, voiceFilter) автоматически синхронизируются с AudioEngine
- Методы `setMusicVolume`, `setVoiceVolume` и т.д. обновляют и Zustand, и AudioEngine
- `loadTrack` из store автоматически применяет все настройки к AudioEngine

### Персистентность

- Сохраняется только `savedTrackId` в localStorage
- При загрузке страницы трек восстанавливается из списка треков
- Если сохраненный трек не найден, выбирается первый трек

### Автоматическое переключение треков

- При окончании трека вызывается `playNext()`
- Учитываются фильтры плейлиста и поиск
- Режимы: sequential (по порядку), random (случайно), loop (повтор)
- Автоматически запускается воспроизведение следующего трека

### Обработка видимости страницы

- При переключении вкладок beat tracking продолжает работать
- При возврате на вкладку выполняется `resyncBeatTracking()` для синхронизации

## 10. Будущие задачи

### Поиск мостиков в композиции

**Задача:** Определить мостики (bridge sections) в композиции и подстроить счет под них.

**Требования для реализации:**

1. **Анализ структуры композиции:**

   - Определение секций (verse, chorus, bridge, outro)
   - Использование librosa для анализа музыкальной структуры
   - Возможно использование ML моделей для сегментации

2. **Определение мостиков:**

   - Анализ изменений в гармонии, ритме, тембре
   - Сравнение с основными секциями
   - Временные метки начала и конца мостиков

3. **Подстройка счета:**

   - Изменение режима счета во время мостиков
   - Возможно: отключение счета или изменение паттерна
   - Сохранение информации о мостиках в БД

4. **Интеграция:**
   - Добавить поля в Track модель: `bridges: Array<{start: number, end: number}>`
   - Обновить AudioEngine для обработки мостиков
   - Добавить UI для ручной корректировки мостиков

**Потенциальные библиотеки:**

- `librosa` — анализ музыкальной структуры
- `essentia` — музыкальный анализ (более продвинутый)
- `madmom` — детекция музыкальных событий
- Custom ML модель для сегментации

**API для анализа:**

- Создать `/api/analyze-structure` endpoint
- Использовать Python скрипт с librosa/essentia
- Возвращать временные метки секций

## 11. Переменные окружения

```env
# Database
DATABASE_URL="mysql://user:password@localhost:3306/bachata_db"

# Demucs (опционально, если установлен в venv)
DEMUCS_PYTHON_PATH=D:\Sites\bachata\venv\Scripts\python.exe
```

## 12. Скрипты

```bash
# Development
npm run dev              # Запуск dev сервера
npm run build            # Сборка для production
npm run start            # Запуск production сервера

# Database
npm run db:generate      # Генерация Prisma Client
npm run db:push          # Применение схемы к БД
npm run db:migrate       # Создание миграции
npm run db:studio        # Открыть Prisma Studio
npm run db:check         # Проверка подключения к БД
npm run db:clear         # Очистка БД и файлов

# Utilities
npm run check:demucs     # Проверка установки Demucs
```

## 13. Зависимости Python

**Для Demucs:**

- Python 3.8+
- FFmpeg
- demucs

**Для анализа BPM/Offset:**

- librosa
- soundfile

**Для будущей задачи (поиск мостиков):**

- librosa (базовый анализ)
- essentia (продвинутый музыкальный анализ, опционально)
- numpy, scipy (для обработки данных)

---

**Версия документа:** 1.0  
**Последнее обновление:** 2024
