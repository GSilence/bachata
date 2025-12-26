# Project Specification: Bachata Beat Counter

## 1. Обзор проекта

Веб-приложение для танцоров бачаты, которое проигрывает музыку и накладывает поверх неё голосовой счет (ритм).
**Цель MVP:** Создать плеер с базовым набором треков, корректной синхронизацией ритма и возможностью переключения режимов счета.

## 2. Технический стек

- **Core:** Next.js 14+ (App Router), React.
- **Language:** TypeScript (строгая типизация всех интерфейсов).
- **Styling:** Tailwind CSS (верстка).
- **Audio Engine:** `Howler.js` (библиотека для надежной работы с Web Audio API, управление громкостью, слоями звука).
- **State Management:** Zustand (легковесный стейт-менеджер для плеера, настроек громкости и списка треков).
- **Database:** MySQL.
- **ORM:** Prisma (для удобной работы с БД и легкой миграции в будущем).
- **Infrastructure:** Docker (контейнеризация для деплоя на Timeweb VPS).

## 3. Архитектура и Документация

В корне проекта создается папка `/docs`, которая является обязательной для ведения истории изменений.

- `/docs/tech-decisions.md` — почему выбрана та или иная библиотека.
- `/docs/schema-changes.md` — лог изменений структуры БД.
- `/docs/deployment.md` — инструкция по развертыванию контейнера.

## 4. Функциональные требования (UI/UX)

### 4.1. Главный экран (Player Interface)

1.  **Секция "Визуализация счета" (Beat Counter):**

    - Горизонтальный ряд цифр: `1 2 3 4 5 6 7 8`.
    - **Активное состояние:** Текущая цифра (в такт музыке) увеличивается (scale-125), становится жирной (font-bold) и меняет цвет (text-primary).
    - **Пассивное состояние:** Остальные цифры полупрозрачны (opacity-50).

2.  **Секция "Управление воспроизведением":**

    - Кнопка **Play/Pause** (Большая, по центру). _Важно: Старт только по клику (no autoplay)._
    - **Progress Bar** (текущее положение трека).
    - **Volume Mixer** (Два независимых ползунка):
      - `Music Volume` (0-100%).
      - `Voice Volume` (0-100%). _Default: на 20% громче музыки._

3.  **Секция "Настройки" (Controls Panel):**

    - **Mode (Режим воспроизведения):**
      - `Sequential` (По порядку).
      - `Random` (Случайно).
      - `Loop` (Один трек).
    - **Voice Filter (Режим озвучки):**
      - `Mute` (Только музыка).
      - `On 1` (Голос говорит "One" на первую долю).
      - `On 1 & 5` (Голос говорит "One" и "Five").
      - `Full` (Опционально: счет 1-8, если потребуется).

4.  **Секция "Плейлист":**
    - Фильтр: `Free` (активен), `My` (disabled/pro), `All` (disabled/pro).
    - Список треков (получаем из MySQL).
    - Поиск по названию.

## 5. Логика работы с Аудио (Audio Engine)

- Используем `Howler.js`.
- Создаются два инстанса `Howl`:
  1.  `musicTrack` — для MP3 файла песни.
  2.  `voiceSample` — короткий сэмпл ("One.mp3", "Five.mp3").
- **Синхронизация:**
  - При загрузке трека получаем метаданные: `bpm` (темп) и `offset` (сдвиг до первого удара в секундах).
  - Вычисляем интервал удара: `60 / bpm`.
  - Используем `requestAnimationFrame` или точный таймер Howler для отслеживания времени и триггера звука голоса в нужный момент: `currentTime >= nextBeatTime`.

## 5.1. Подсистема обработки аудио (Spleeter Integration) - MVP

_Примечание: Реализуется как локальная функция для администратора, с возможностью деплоя на VDS._

**Требования:**

1.  На сервере (или локальной машине разработчика) должен быть установлен **Python 3.8+** и **FFmpeg**.
2.  Установлена библиотека Spleeter: `pip install spleeter`.

**Алгоритм работы (Admin Upload Flow):**

1.  Администратор загружает MP3 файл через форму в `/admin/upload`.
2.  **Next.js API Route** (`/api/process-track`):
    - Сохраняет исходный файл в `./public/uploads/raw/`.
    - Использует Node.js `child_process.exec` для запуска команды Spleeter:
      `spleeter separate -p spleeter:4stems -o ./public/uploads/stems/ [path_to_file]`
    - _Важно:_ Процесс асинхронный. Для MVP можно заставить админа ждать окончания загрузки (лоадер), либо реализовать простую очередь.
3.  После успешного выполнения скрипта, API сканирует созданную папку, находит 4 файла (`vocals`, `drums`, `bass`, `other`).
4.  Создает запись в БД (таблица `Track`), сохраняя пути ко всем 4-м файлам (плюс к оригинальному).

**Формат хранения данных (Prisma Update):**

````prisma
model Track {
  id          Int      @id @default(autoincrement())
  title       String
  // ...остальные поля...

  // Пути к файлам (если null, значит трек не разложен)
  pathOriginal String
  pathVocals   String?
  pathDrums    String?
  pathBass     String?
  pathOther    String?

  isProcessed  Boolean @default(false)
}


## 6. База Данных (MySQL Schema Draft)

Используем Prisma Schema.

```prisma
model Track {
  id          Int      @id @default(autoincrement())
  title       String
  artist      String?
  filename    String   // путь к файлу в /public/music или S3
  bpm         Int      // ударов в минуту
  offset      Float    // смещение первого бита (сек)
  isFree      Boolean  @default(true)
  createdAt   DateTime @default(now())
}

// Задел на будущее (пока не используется в MVP)
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  password  String
  // ... relations to UserTracks
}
````
