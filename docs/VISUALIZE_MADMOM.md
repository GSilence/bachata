# Визуализация результатов Madmom

Скрипт `scripts/visualize_madmom.py` создает интерактивную HTML-визуализацию результатов анализа madmom для отладки и проверки.

## Быстрый старт

### Windows (PowerShell)

1. **Откройте PowerShell в корне проекта** (`d:\Sites\bachata\`)

2. **Активируйте виртуальное окружение:**
   ```powershell
   .\venv\Scripts\Activate.ps1
   ```

3. **Запустите визуализацию:**
   ```powershell
   python scripts/visualize_madmom.py public/uploads/raw/20254a93-4cc0-4792-8936-1b7cd19768fd.mp3
   ```

4. **Откройте созданный HTML файл в браузере:**
   - Файл будет создан в текущей директории с именем `20254a93-4cc0-4792-8936-1b7cd19768fd_madmom_visualization.html`
   - Или укажите свой путь: `python scripts/visualize_madmom.py audio.mp3 -o my_visualization.html`

### Linux / macOS

1. **Активируйте виртуальное окружение:**
   ```bash
   source venv/bin/activate
   ```

2. **Запустите визуализацию:**
   ```bash
   python scripts/visualize_madmom.py public/uploads/raw/20254a93-4cc0-4792-8936-1b7cd19768fd.mp3
   ```

## Использование

### Базовое использование

```bash
# Визуализировать результат анализа (скрипт автоматически запустит analyze-track.py)
python scripts/visualize_madmom.py path/to/audio.mp3
```

### С указанием выходного файла

```bash
python scripts/visualize_madmom.py path/to/audio.mp3 -o visualization.html
```

### Из сохраненного JSON результата

Если у вас уже есть JSON файл с результатами анализа:

```bash
python scripts/visualize_madmom.py path/to/audio.mp3 --analysis-json result.json
```

## Что показывает визуализация

- **Beats** (синие линии) - все обнаруженные удары
- **Downbeats** (зеленые линии) - сильные доли (где number == 1)
- **Grid sections** (цветные блоки):
  - Зеленый - Verse секции
  - Оранжевый - Bridge секции
- **Timeline** с временными метками каждые 10 секунд
- **Информация о треке**: BPM, Offset, Duration, количество beats и downbeats

## Интерактивные элементы

- **Zoom In/Out** - увеличение/уменьшение масштаба
- **Reset** - сброс масштаба
- **Toggle Beats** - показать/скрыть все beats
- **Toggle Downbeats** - показать/скрыть downbeats
- **Toggle Grid** - показать/скрыть grid sections

## Примеры путей

### Относительные пути (от корня проекта)

```bash
# Файл в public/uploads/raw/
python scripts/visualize_madmom.py public/uploads/raw/filename.mp3

# Файл в public/music/
python scripts/visualize_madmom.py public/music/song.mp3
```

### Абсолютные пути

```bash
python scripts/visualize_madmom.py "D:\Sites\bachata\public\uploads\raw\filename.mp3"
```

## Устранение проблем

### Ошибка: "madmom is required but not available"

Убедитесь, что:
1. Виртуальное окружение активировано
2. Madmom установлен: `pip install madmom`

### Ошибка: "Audio file not found"

Проверьте путь к файлу:
- Используйте относительный путь от корня проекта
- Или абсолютный путь в кавычках (Windows)

### Ошибка: "No beats detected"

Это означает, что madmom не смог обнаружить beats в аудио. Возможные причины:
- Файл поврежден
- Аудио слишком тихое или без четкого ритма
- Проблемы с форматом файла

## Примечания

- Скрипт автоматически запускает `analyze-track.py` для получения результатов анализа
- HTML файл можно открыть в любом современном браузере
- Визуализация работает полностью офлайн (не требует интернета)

