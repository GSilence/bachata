# Установка зависимостей для analyze_beat.py

## Быстрая установка

### Windows (PowerShell)

```powershell
# 1. Активируйте виртуальное окружение
.\venv\Scripts\Activate.ps1

# 2. Сначала установите build-зависимости (важно!)
pip install Cython setuptools wheel

# 3. Затем установите остальные зависимости
pip install -r requirements.txt
```

### Linux / macOS

```bash
# 1. Активируйте виртуальное окружение
source venv/bin/activate

# 2. Установите зависимости
pip install -r requirements.txt
```

## Системные зависимости

### Windows
- **FFmpeg** (для madmom): 
  - Скачайте с https://ffmpeg.org/download.html
  - Или установите через chocolatey: `choco install ffmpeg`

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install ffmpeg libsndfile1
```

### macOS
```bash
brew install ffmpeg libsndfile
```

## Проверка установки

```bash
python -c "from madmom.features.beats import RNNDownBeatProcessor; print('Madmom OK')"
```

Если вы видите "Madmom OK", установка прошла успешно.

## Использование

```bash
python scripts/analyze_beat.py path/to/audio.mp3
```

## Формат вывода

Скрипт выводит JSON в stdout:
```json
{
  "bpm": 123.0,
  "offset": 0.5,
  "beats": [
    {"time": 0.5, "number": 1},
    {"time": 1.0, "number": 2},
    {"time": 1.5, "number": 3},
    ...
  ]
}
```

## ⚠️ Установка на Windows

На Windows установка madmom требует **Microsoft Visual C++ Build Tools** (компилятор C/C++).

**📖 Подробная инструкция:** См. [docs/INSTALL_CPP_BUILD_TOOLS.md](docs/INSTALL_CPP_BUILD_TOOLS.md)

**Краткая версия:**
1. Скачайте [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. При установке выберите **"C++ build tools"**
3. Перезапустите терминал
4. Установите: `pip install Cython setuptools wheel && pip install madmom`

Подробная документация: [docs/MADMOM_SETUP.md](docs/MADMOM_SETUP.md)

