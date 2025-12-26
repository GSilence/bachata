# Установка Demucs и librosa

Demucs — это инструмент для разделения аудиофайлов на отдельные компоненты (vocals, drums, bass, other) с высоким качеством.

## Требования

- **Python 3.8+**
- **FFmpeg** (должен быть установлен и доступен в PATH)

## Установка

### 1. Установка через pip

```bash
# Установка Demucs
pip install demucs

# Установка librosa для анализа BPM и Offset
pip install librosa soundfile
```

Или через Python модуль:

```bash
python -m pip install demucs librosa soundfile
```

### 2. Установка в виртуальное окружение (рекомендуется)

```bash
# Создайте виртуальное окружение (если еще не создано)
python -m venv venv

# Активируйте его
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Установите все зависимости
pip install demucs librosa soundfile
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# Windows CMD:
venv\Scripts\activate.bat
# Linux/Mac:
source venv/bin/activate

# Установите Demucs
pip install demucs
```

### 3. Настройка переменных окружения

Если Demucs установлен в виртуальном окружении, добавьте в `.env.local`:

```env
DEMUCS_PYTHON_PATH=D:\Sites\bachata\venv\Scripts\python.exe
```

Замените путь на актуальный путь к Python в вашем venv.

## Проверка установки

```bash
npm run check:demucs
```

Или напрямую:

```bash
demucs --help
python -m demucs.separate --help
```

## Использование

Demucs автоматически используется при загрузке треков через админ-панель (`/admin/upload`).

### Команда, которая выполняется:

```bash
demucs [input_file] -o [output_dir]
```

Или через Python:

```bash
python -m demucs.separate [input_file] -o [output_dir]
```

### Структура выходных файлов

Demucs создает следующую структуру:

```
public/uploads/stems/
  htdemucs/
    track_name/
      vocals.wav
      drums.wav
      bass.wav
      other.wav
```

## Модели Demucs

По умолчанию используется модель `htdemucs` (лучшее качество). Поддерживаются также:

- `htdemucs_ft` - fine-tuned версия
- `mdx_extra` - альтернативная модель
- `mdx_extra_q` - быстрая версия

## Производительность

- **CPU**: Обработка 4-минутного трека может занять 1-3 минуты
- **GPU**: Обработка значительно быстрее (20-30 секунд)

## Решение проблем

### Demucs не найден

1. Проверьте установку: `pip list | grep demucs`
2. Убедитесь, что Python в PATH: `python --version`
3. Если установлен в venv, активируйте его или используйте `DEMUCS_PYTHON_PATH` в `.env.local`

### Ошибка при обработке

1. Проверьте, что FFmpeg установлен: `ffmpeg -version`
2. Убедитесь, что входной файл валидный аудиофайл
3. Проверьте логи в консоли сервера

### Таймаут при обработке

Обработка больших файлов может занять много времени. Таймаут установлен на 10 минут. Если файл очень большой, увеличьте таймаут в `lib/demucs.ts`.

## Дополнительная информация

- [Официальный репозиторий Demucs](https://github.com/facebookresearch/demucs)
- [Документация Demucs](https://github.com/facebookresearch/demucs#usage)
