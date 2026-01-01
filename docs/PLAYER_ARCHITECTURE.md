# Архитектура Плеера: Bachata Beat Counter

## Обзор

Плеер использует **Store-Driven Architecture** с Singleton AudioEngine. Все операции с аудио контролируются через Zustand Store, что обеспечивает единый источник истины и предотвращает race conditions.

## Компоненты Архитектуры

### 1. AudioEngine (`lib/audioEngine.ts`)

**Паттерн:** Singleton

**Ключевые особенности:**
- Единственный экземпляр на всё приложение: `export const audioEngine = AudioEngine.getInstance()`
- Поддержка двух режимов воспроизведения:
  - **Full File Mode** (по умолчанию): один Howl-инстанс для цельного файла
  - **Stems Mode**: четыре Howl-инстанса для отдельных дорожек (vocals, drums, bass, other)
- Агрессивная очистка ресурсов для предотвращения "HTML5 Audio pool exhausted"

**Критические методы:**

#### `loadTrack(track: Track, isStemsMode?, stemsEnabled?, stemsVolume?)`
**Последовательность операций (КРИТИЧЕСКИ ВАЖНО):**
1. **STEP 1:** `this.stop()` - останавливает воспроизведение (симулирует нажатие Stop)
2. **STEP 2:** `this.unloadTrack()` - выгружает трек и вызывает `Howler.unload()` (убивает все зомби-инстансы)
3. **STEP 3:** Обновление настроек стемов (если переданы)
4. **STEP 4:** Сброс состояния (`currentBeatIndex = 0`, `trackEndFired = false`)
5. **STEP 5:** Построение `beatMap` из `gridMap` (если доступен)
6. **STEP 6:** Загрузка трека в зависимости от режима:
   - **Full File Mode** (`isStemsMode === false` или трек не обработан): создание одного `Howl` инстанса для `track.pathOriginal`
   - **Stems Mode** (`isStemsMode === true` и `track.isProcessed === true`): создание четырёх `Howl` инстансов для `pathVocals`, `pathDrums`, `pathBass`, `pathOther`

**Важно:** `loadTrack` ВСЕГДА вызывает `stop()` и `unloadTrack()` первыми. Это гарантирует чистый срез перед загрузкой нового трека.

**Параметры стемов:**
- `isStemsMode?: boolean` - использовать ли стемы (4 дорожки) или цельный файл
- `stemsEnabled?: { vocals, drums, bass, other }` - какие стемы включены
- `stemsVolume?: { vocals, drums, bass, other }` - громкость каждого стема (0-100)

#### `unloadTrack()`
- Останавливает update loop
- Останавливает воспроизведение цельного файла (если загружен)
- Останавливает воспроизведение всех стемов (если загружены)
- Сбрасывает позицию в 0 для всех инстансов
- Отключает все события (`oldTrack.off()`) для всех инстансов
- Выгружает все инстансы (`oldTrack.unload()`) - и цельный файл, и стемы
- **КРИТИЧНО:** Вызывает `Howler.unload()` для глобальной очистки всех инстансов

#### `stop()`
- Останавливает воспроизведение
- Сбрасывает позицию в 0
- Сбрасывает `currentBeatIndex = 0`
- Останавливает update loop

#### `seek(time: number)`
- Обновляет позицию в Howl (цельный файл или все стемы синхронизированно)
- Сбрасывает `currentBeatIndex` в соответствии с новой позицией

#### `play()`, `pause()`, `stop()`
- **Full File Mode:** Работают с одним Howl-инстансом
- **Stems Mode:** Работают со всеми четырьмя стемами синхронизированно
- В Stems Mode воспроизводятся только включённые стемы (`stemsEnabled`)

#### `getCurrentTime()`, `getDuration()`, `isPlaying()`
- **Full File Mode:** Возвращают значения из единственного Howl-инстанса
- **Stems Mode:** Используют `vocals` как основной источник времени/длительности (fallback на другие стемы)

### Управление Стемами

#### `setStemsMode(enabled: boolean)`
- Переключает режим воспроизведения между Full File и Stems Mode
- **КРИТИЧНО:** Если трек уже загружен, автоматически перезагружает его в новом режиме
- Сохраняет текущую позицию воспроизведения и состояние (playing/paused)

#### `setStemsEnabled(stems: Partial<{vocals, drums, bass, other}>)`
- Включает/выключает отдельные стемы
- Обновляет громкость: выключенные стемы получают `volume = 0`
- Работает в реальном времени (не требует перезагрузки трека)

#### `setStemsVolume(stems: Partial<{vocals, drums, bass, other}>)`
- Устанавливает громкость каждого стема (0-100)
- Финальная громкость вычисляется как: `musicVolume * stemVolume * (enabled ? 1 : 0)`
- Работает в реальном времени (не требует перезагрузки трека)

### 2. PlayerStore (`store/playerStore.ts`)

**Роль:** Контроллер всех аудио-операций

**Ключевые действия:**

#### `setCurrentTrack(track: Track)`
**Последовательность (КРИТИЧЕСКИ ВАЖНО):**
1. **STEP 1:** НЕМЕДЛЕННО сбрасывает состояние в store:
   ```typescript
   set({
     currentTrack: track,
     isPlaying: false,
     currentTime: 0,
     duration: 0, // КРИТИЧНО: предотвращает использование старой длительности для seek
   });
   ```
2. **STEP 2:** `audioEngine.stop()` - останавливает воспроизведение
3. **STEP 3:** `audioEngine.loadTrack(track, isStemsMode, stemsEnabled, stemsVolume)` - загружает новый трек с текущими настройками стемов
4. **STEP 4:** Устанавливает громкость из store

**Почему важно сбрасывать duration сразу:**
- Если `duration` остаётся от предыдущего трека, то при клике на прогресс-бар расчёт `newTime = percentage * duration` будет неправильным
- UI должен показывать "0:00 / 0:00" до загрузки нового трека

#### `play()`, `pause()`, `stop()`
- Прямые вызовы методов `audioEngine`
- Синхронизируют состояние store с AudioEngine

#### `setStemsMode(enabled: boolean)`
- Обновляет `isStemsMode` в store
- Вызывает `audioEngine.setStemsMode(enabled)` для переключения режима
- Если трек загружен, AudioEngine автоматически перезагружает его в новом режиме

#### `setStemsEnabled(stems)`, `setStemsVolume(stems)`
- Обновляют настройки стемов в store
- Синхронизируют изменения с AudioEngine в реальном времени

#### `playNext()`, `playPrevious()`
- Вычисляют следующий/предыдущий трек
- Вызывают `setCurrentTrack()` (который включает обязательную логику Stop)

### 3. PlayerControls (`components/PlayerControls.tsx`)

**Паттерн:** Interaction Lock для предотвращения race conditions

**Ключевые элементы:**

#### Interaction Lock (`isInteractingRef`)
```typescript
const isInteractingRef = useRef(false);
```

**Назначение:** Блокирует обновления из update loop во время пользовательских взаимодействий (seek).

#### Smart Update Loop
```typescript
useEffect(() => {
  const updateLoop = () => {
    const state = usePlayerStore.getState();
    
    // КРИТИЧНО: Обновляем ТОЛЬКО если НЕ dragging, НЕ interacting, И playing
    if (!isDragging && !isInteractingRef.current && state.isPlaying) {
      const time = audioEngine.getCurrentTime();
      const dur = audioEngine.getDuration();
      
      state.setCurrentTime(time);
      
      if (dur > 0 && dur !== state.duration) {
        usePlayerStore.setState({ duration: dur });
      }
    }
    
    rafId = requestAnimationFrame(updateLoop);
  };
  
  rafId = requestAnimationFrame(updateLoop);
  return () => cancelAnimationFrame(rafId);
}, [isDragging]);
```

**Логика обновления:**
- Обновляет store только когда `!isDragging && !isInteractingRef.current && isPlaying`
- Это гарантирует, что engine НИКОГДА не перезаписывает UI во время взаимодействий
- Работает на 60 FPS (requestAnimationFrame)

#### `handleProgressClick` - Interaction Lock Pattern
```typescript
const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
  // STEP 1: Блокируем обновления
  isInteractingRef.current = true;
  
  // STEP 2: Вычисляем новое время
  const newTime = percentage * duration;
  
  // STEP 3: Оптимистично обновляем store (мгновенная визуальная обратная связь)
  setCurrentTime(newTime);
  
  // STEP 4: Командуем engine выполнить seek
  audioEngine.seek(newTime);
  
  // STEP 5: Разблокируем через 200ms (cooldown)
  setTimeout(() => {
    isInteractingRef.current = false;
  }, 200);
};
```

**Почему 200ms cooldown:**
- AudioEngine нужно время, чтобы физически обработать seek операцию
- Если разблокировать сразу, update loop прочитает старое время и перезапишет UI
- 200ms достаточно для обработки seek, но достаточно быстро для пользователя

## Последовательности Операций

### Смена Трека

```
User clicks track
  ↓
store.playNext() / setCurrentTrack()
  ↓
STEP 1: set({ currentTrack, currentTime: 0, duration: 0 }) // НЕМЕДЛЕННО
  ↓
STEP 2: audioEngine.stop()
  ↓
STEP 3: audioEngine.loadTrack(track, isStemsMode, stemsEnabled, stemsVolume)
  ├─→ audioEngine.stop() (внутри loadTrack)
  ├─→ audioEngine.unloadTrack()
  │   ├─→ Howler.unload() // Глобальная очистка
  │   ├─→ oldTrack.unload() (если Full File Mode)
  │   └─→ oldStems.unload() (если Stems Mode - все 4 стема)
  ├─→ Определение режима: isStemsMode && track.isProcessed?
  │   ├─→ Full File Mode: new Howl({ src: [pathOriginal] })
  │   └─→ Stems Mode: new Howl({ src: [pathVocals] })
  │                  + new Howl({ src: [pathDrums] })
  │                  + new Howl({ src: [pathBass] })
  │                  + new Howl({ src: [pathOther] })
  └─→ Настройка громкости для каждого инстанса
  ↓
STEP 4: audioEngine.setMusicVolume()
  ↓
UI показывает новый трек с duration: 0
  ↓
Update Loop обнаруживает isPlaying && duration === 0
  ↓
Update Loop обновляет duration из audioEngine.getDuration()
  ↓
UI показывает правильную длительность
```

### Переключение Stems Mode

```
User toggles Stems Mode switch
  ↓
store.setStemsMode(enabled)
  ↓
STEP 1: set({ isStemsMode: enabled })
  ↓
STEP 2: audioEngine.setStemsMode(enabled)
  ├─→ Сохранение текущей позиции: currentTime = getCurrentTime()
  ├─→ Сохранение состояния: wasPlaying = isPlaying()
  ├─→ loadTrack(currentTrack, newMode, stemsEnabled, stemsVolume)
  │   └─→ Перезагрузка в новом режиме (Full File ↔ Stems)
  └─→ Восстановление позиции и состояния через 150ms
  ↓
Трек перезагружен в новом режиме
  ↓
Позиция и воспроизведение восстановлены
```

### Seek (Клик на Прогресс-бар)

```
User clicks progress bar
  ↓
handleProgressClick()
  ↓
STEP 1: isInteractingRef.current = true // БЛОКИРУЕМ обновления
  ↓
STEP 2: newTime = calculateTimeFromClick()
  ↓
STEP 3: setCurrentTime(newTime) // Оптимистичное обновление (мгновенно)
  ↓
STEP 4: audioEngine.seek(newTime) // Команда engine
  ↓
STEP 5: setTimeout(() => isInteractingRef.current = false, 200ms)
  ↓
[200ms cooldown - update loop НЕ обновляет]
  ↓
Cooldown завершён
  ↓
Update loop возобновляет обновления
  ↓
UI синхронизируется с реальным временем из engine
```

### Воспроизведение

```
User clicks Play
  ↓
store.play()
  ↓
audioEngine.play()
  ↓
Update Loop: isPlaying = true && !isInteractingRef
  ↓
Update Loop обновляет currentTime каждые ~16ms (60 FPS)
  ↓
UI показывает плавное движение прогресс-бара
```

## Критические Тонкости Синхронизации

### 1. Stale Duration Problem

**Проблема:** При смене трека старая `duration` остаётся в store, что приводит к неправильным расчётам seek.

**Решение:** В `setCurrentTrack()` сбрасываем `duration: 0` НЕМЕДЛЕННО, до загрузки трека.

```typescript
// ПРАВИЛЬНО:
set({ currentTrack: track, duration: 0 }); // Сначала
audioEngine.loadTrack(track); // Потом

// НЕПРАВИЛЬНО:
audioEngine.loadTrack(track); // Сначала
set({ duration: 0 }); // Потом - уже поздно, пользователь мог кликнуть
```

### 2. Race Condition при Seek

**Проблема:** Пользователь кликает → UI обновляется → update loop читает старое время → UI "прыгает назад".

**Решение:** Interaction Lock Pattern
- Блокируем обновления на время обработки seek
- Оптимистично обновляем UI сразу
- Разблокируем после cooldown (200ms)

### 3. HTML5 Audio Pool Exhaustion

**Проблема:** Браузер ограничивает количество одновременных `<audio>` элементов (~6-10).

**Решение:**
- Singleton AudioEngine (только один инстанс)
- Агрессивная очистка: `Howler.unload()` перед каждым `loadTrack()`
- `unloadTrack()` полностью выгружает старый трек перед созданием нового

### 4. Double Audio Bug

**Проблема:** При быстрой смене треков старый трек продолжает играть.

**Решение:**
- `loadTrack()` ВСЕГДА вызывает `stop()` и `unloadTrack()` первыми
- `setCurrentTrack()` вызывает `audioEngine.stop()` перед `loadTrack()`
- Store-Driven: все операции идут через store, нет дублирования логики

### 5. Zombie Instances

**Проблема:** Howl инстансы не освобождаются из памяти.

**Решение:**
- `unloadTrack()` вызывает `oldTrack.off()` (отключает все события)
- `unloadTrack()` вызывает `oldTrack.unload()` (освобождает HTML5 Audio элемент)
- `unloadTrack()` вызывает `Howler.unload()` (глобальная очистка всех инстансов)
- В Stems Mode выгружаются все 4 стема перед загрузкой новых

### 6. Stems Mode Resource Management

**Проблема:** Stems Mode использует 4 Howl-инстанса вместо одного, что увеличивает нагрузку на HTML5 Audio pool.

**Решение:**
- По умолчанию используется Full File Mode (экономия ресурсов)
- Stems Mode активируется только для обработанных треков (`isProcessed === true`)
- При переключении режима старые инстансы полностью выгружаются перед созданием новых
- `Howler.unload()` вызывается для глобальной очистки при каждой смене трека

## Правила Разработки

### ✅ ДЕЛАТЬ

1. **Всегда использовать store для управления треками:**
   ```typescript
   // ✅ ПРАВИЛЬНО
   usePlayerStore.getState().setCurrentTrack(track);
   
   // ❌ НЕПРАВИЛЬНО
   audioEngine.loadTrack(track); // Напрямую
   ```

2. **Сбрасывать duration при смене трека:**
   ```typescript
   set({ duration: 0 }); // Сначала
   audioEngine.loadTrack(track); // Потом
   ```

3. **Использовать Interaction Lock при seek:**
   ```typescript
   isInteractingRef.current = true;
   setCurrentTime(newTime);
   audioEngine.seek(newTime);
   setTimeout(() => { isInteractingRef.current = false; }, 200);
   ```

4. **Проверять флаги в update loop:**
   ```typescript
   if (!isDragging && !isInteractingRef.current && isPlaying) {
     // Обновлять
   }
   ```

### ❌ НЕ ДЕЛАТЬ

1. **Не создавать новые AudioEngine инстансы:**
   ```typescript
   // ❌ НЕПРАВИЛЬНО
   const engine = new AudioEngine();
   
   // ✅ ПРАВИЛЬНО
   import { audioEngine } from "@/lib/audioEngine";
   ```

2. **Не обновлять UI напрямую из update loop во время взаимодействий:**
   ```typescript
   // ❌ НЕПРАВИЛЬНО
   if (isPlaying) {
     setCurrentTime(time); // Без проверки isInteractingRef
   }
   ```

3. **Не использовать локальное состояние для currentTime:**
   ```typescript
   // ❌ НЕПРАВИЛЬНО
   const [localTime, setLocalTime] = useState(0);
   
   // ✅ ПРАВИЛЬНО
   const { currentTime } = usePlayerStore(); // Единый источник истины
   ```

4. **Не загружать трек без предварительной очистки:**
   ```typescript
   // ❌ НЕПРАВИЛЬНО
   audioEngine.loadTrack(track); // Без stop() и unloadTrack()
   
   // ✅ ПРАВИЛЬНО
   audioEngine.stop();
   audioEngine.unloadTrack();
   audioEngine.loadTrack(track);
   ```

5. **Передавать настройки стемов при загрузке трека:**
   ```typescript
   // ✅ ПРАВИЛЬНО
   const { isStemsMode, stemsEnabled, stemsVolume } = get();
   audioEngine.loadTrack(track, isStemsMode, stemsEnabled, stemsVolume);
   ```

6. **Использовать store для управления стемами:**
   ```typescript
   // ✅ ПРАВИЛЬНО
   usePlayerStore.getState().setStemsMode(true);
   usePlayerStore.getState().setStemsEnabled({ vocals: false });
   usePlayerStore.getState().setStemsVolume({ drums: 50 });
   ```

## Диаграмма Потока Данных

```
┌─────────────────┐
│  User Action    │
│  (Click, Play)  │
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│  PlayerStore    │ ◄─── Single Source of Truth
│  (Zustand)      │
└────────┬─────────┘
         │
         ├──► setCurrentTrack() ──► audioEngine.stop()
         │                          audioEngine.loadTrack()
         │
         ├──► play() ──────────────► audioEngine.play()
         │
         ├──► pause() ─────────────► audioEngine.pause()
         │
         ├──► seek() ──────────────► audioEngine.seek()
         │
         ├──► setStemsMode() ──────► audioEngine.setStemsMode()
         │
         ├──► setStemsEnabled() ───► audioEngine.setStemsEnabled()
         │
         └──► setStemsVolume() ────► audioEngine.setStemsVolume()
         
         │
         ▼
┌─────────────────┐
│  AudioEngine    │
│  (Singleton)    │
│                 │
│  Full File Mode │───► Howl (pathOriginal)
│  Stems Mode     │───► Howl (pathVocals)
│                 │    Howl (pathDrums)
│                 │    Howl (pathBass)
│                 │    Howl (pathOther)
└────────┬─────────┘
         │
         │ getCurrentTime()
         │ getDuration()
         │         │
         │         ▼
         │  ┌─────────────────┐
         │  │  Update Loop    │
         │  │  (60 FPS)        │
         │  └────────┬─────────┘
         │           │
         │           │ (if !isInteractingRef)
         │           ▼
         │  ┌─────────────────┐
         │  │  PlayerStore    │
         │  │  setCurrentTime │
         │  └────────┬─────────┘
         │           │
         │           ▼
         └───────────┴──────────► UI Updates

## Отладка

### Проблема: "HTML5 Audio pool exhausted"
**Причина:** Слишком много Howl инстансов в памяти.
**Решение:** Проверить, что `Howler.unload()` вызывается в `unloadTrack()`.

### Проблема: Прогресс-бар "прыгает назад" после клика
**Причина:** Race condition - update loop перезаписывает UI до завершения seek.
**Решение:** Проверить, что `isInteractingRef.current = true` устанавливается перед seek и сбрасывается через 200ms.

### Проблема: Неправильная позиция при клике на прогресс-бар
**Причина:** Stale duration - используется длительность предыдущего трека.
**Решение:** Проверить, что `duration: 0` сбрасывается в `setCurrentTrack()` ДО `loadTrack()`.

### Проблема: Двойное воспроизведение
**Причина:** Старый трек не выгружен перед загрузкой нового.
**Решение:** Проверить, что `loadTrack()` вызывает `stop()` и `unloadTrack()` первыми.

### Проблема: Stems не синхронизированы
**Причина:** Стемы запускаются не одновременно или seek применяется не ко всем.
**Решение:** Проверить, что в `play()` и `seek()` все стемы обрабатываются в цикле синхронизированно.

### Проблема: Переключение Stems Mode сбрасывает позицию
**Причина:** Недостаточный timeout для восстановления позиции после перезагрузки.
**Решение:** Проверить, что в `setStemsMode()` timeout составляет минимум 150ms для загрузки стемов.

## Заключение

Архитектура плеера построена на принципах:
1. **Store-Driven:** Все операции через Zustand Store
2. **Singleton:** Один AudioEngine на всё приложение
3. **Interaction Lock:** Защита от race conditions при пользовательских взаимодействиях
4. **Агрессивная очистка:** Предотвращение утечек ресурсов
5. **Оптимистичные обновления:** Мгновенная обратная связь для пользователя
6. **Dual Mode:** Поддержка Full File Mode (по умолчанию) и Stems Mode для обработанных треков
7. **Синхронизация стемов:** Все 4 дорожки воспроизводятся синхронизированно при seek/play/pause

Следование этим принципам гарантирует стабильную работу плеера без багов синхронизации.

