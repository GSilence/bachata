# Текстовый вывод результатов анализа Madmom

## Описание

Скрипт `scripts/print-madmom-results.py` позволяет получить подробный текстовый вывод результатов анализа madmom без необходимости создавать HTML визуализацию.

## Использование

### Базовое использование

```bash
python scripts/print-madmom-results.py path/to/audio.mp3
```

### Показать все beats (не только первые 20)

```bash
python scripts/print-madmom-results.py path/to/audio.mp3 --all-beats
```

## Что выводит скрипт

Скрипт выводит:

1. **Информацию о процессе анализа:**

   - Форма и характеристики activation function от RNNDownBeatProcessor
   - Количество обнаруженных beats
   - Распределение меток beats (1=downbeat, 2-4=обычные beats)
   - Статистика интервалов между beats

2. **Результаты анализа:**

   - BPM (темп)
   - Offset (смещение первого downbeat)
   - Количество downbeats и total beats
   - Первые 10 beats с их метками
   - Первые 10 downbeats

3. **Grid секции:**

   - Все секции (verse/bridge) с временными метками
   - Количество beats в каждой секции
   - Детальная информация о bridge секциях

4. **JSON результат:**
   - Полный JSON результат анализа (если есть beats array)

## Пример вывода

```
================================================================================
MADMOM ANALYSIS - Text Output
================================================================================
Audio file: song.mp3
File size: 5.23 MB

Running analysis...
--------------------------------------------------------------------------------
================================================================================
MADMOM ANALYSIS - Processing audio file...
================================================================================
Step 1: Running RNNDownBeatProcessor...
  ✓ Activation function shape: (1234, 5)
  ✓ Activation function dtype: float32
  ✓ Activation range: [0.0000, 0.9876]
  ✓ Activation mean: 0.1234
Step 2: Running DBNBeatTrackingProcessor...
  ✓ Detected 456 beats total

Step 3: Extracting beats and downbeats...
  ✓ Beat labels distribution:
    - Downbeat (1): 114 beats
    - Beat (2): 114 beats
    - Beat (3): 114 beats
    - Beat (4): 114 beats

Step 4: Calculating BPM from beat intervals...
  ✓ Average interval: 0.5000s
  ✓ Interval range: [0.4800s, 0.5200s]
  ✓ Interval std dev: 0.0100s

================================================================================
MADMOM ANALYSIS RESULTS:
================================================================================
  BPM: 120
  Offset: 0.500s
  Downbeats: 114
  Total beats: 456

First 10 beats detected:
  [ 1]   0.500s - DOWNBEAT
  [ 2]   1.000s - beat-2
  [ 3]   1.500s - beat-3
  ...

================================================================================
ANALYSIS RESULTS (JSON):
================================================================================
{
  "bpm": 120,
  "offset": 0.5,
  "duration": 180.0,
  "grid": [
    {
      "type": "verse",
      "start": 0.0,
      "beats": 32
    },
    ...
  ]
}

================================================================================
SUMMARY:
================================================================================
BPM: 120
Offset: 0.5s
Duration: 180.0s

Grid sections: 8
  - Verse: 6
  - Bridge: 2

All grid sections:
  [ 1] VERSE  | Start:   0.000s | Beats:  32 | End:  16.000s | Duration:  16.00s
  [ 2] BRIDGE | Start:  16.000s | Beats:   4 | End:  18.000s | Duration:   2.00s
  ...
```

## Отличия от visualize_madmom.py

- **print-madmom-results.py**: Текстовый вывод в консоль, удобен для быстрой проверки результатов
- **visualize_madmom.py**: Создает HTML файл с интерактивной визуализацией, удобен для детального анализа

## Устранение проблем

### Ошибка: "madmom is required but not available"

Убедитесь, что:

1. Виртуальное окружение активировано
2. Madmom установлен: `pip install madmom`
3. Все зависимости установлены: `pip install -r requirements.txt`

### Ошибка: "No beats detected"

Это означает, что madmom не смог обнаружить beats в аудио. Возможные причины:

- Аудио файл поврежден
- Аудио слишком короткое
- Аудио не содержит четкого ритма

Попробуйте другой аудио файл или проверьте качество файла.

## См. также

- [MADMOM_SETUP.md](MADMOM_SETUP.md) - Установка и настройка madmom
- [VISUALIZE_MADMOM.md](VISUALIZE_MADMOM.md) - HTML визуализация результатов
