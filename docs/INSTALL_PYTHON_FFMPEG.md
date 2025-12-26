# Установка Python 3.8+ и FFmpeg на Windows

## Шаг 1: Установка Python

### Вариант A: Официальный установщик (Рекомендуется)

1. **Скачайте Python:**

   - Перейдите на https://www.python.org/downloads/
   - Нажмите кнопку "Download Python 3.x.x" (последняя версия)
   - Или выберите конкретную версию: https://www.python.org/downloads/windows/

2. **Запустите установщик:**

   - Откройте скачанный `.exe` файл
   - **ВАЖНО:** Отметьте галочку **"Add Python to PATH"** внизу окна установки
   - Нажмите "Install Now"

3. **Проверьте установку:**

   - Откройте PowerShell или Command Prompt
   - Выполните:
     ```powershell
     python --version
     ```
   - Должно вывести: `Python 3.x.x`

4. **Если `python` не найден:**
   - Переустановите Python, обязательно отметив "Add Python to PATH"
   - Или добавьте вручную:
     - Win + R → `sysdm.cpl` → Enter
     - Вкладка "Дополнительно" → "Переменные среды"
     - В "Системные переменные" найдите `Path` → "Изменить"
     - "Создать" → добавьте: `C:\Users\ВашеИмя\AppData\Local\Programs\Python\Python3xx\`
     - И еще: `C:\Users\ВашеИмя\AppData\Local\Programs\Python\Python3xx\Scripts\`
     - Перезапустите терминал

### Вариант B: Через Microsoft Store (Альтернатива)

1. Откройте Microsoft Store
2. Найдите "Python 3.11" или "Python 3.12"
3. Нажмите "Установить"
4. Проверьте: `python --version`

---

## Шаг 2: Установка FFmpeg

### Вариант A: Через Chocolatey (Самый простой)

1. **Установите Chocolatey (если еще не установлен):**

   - Откройте PowerShell **от имени администратора**
   - Выполните:
     ```powershell
     Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
     ```

2. **Установите FFmpeg:**

   ```powershell
   choco install ffmpeg -y
   ```

3. **Проверьте:**
   ```powershell
   ffmpeg -version
   ```

### Вариант B: Ручная установка

1. **Скачайте FFmpeg:**

   - Перейдите на https://www.gyan.dev/ffmpeg/builds/
   - Скачайте "ffmpeg-release-essentials.zip" (или "ffmpeg-release-full.zip")

2. **Распакуйте архив:**

   - Создайте папку `C:\ffmpeg`
   - Распакуйте туда содержимое архива
   - Должна получиться структура: `C:\ffmpeg\bin\ffmpeg.exe`

3. **Добавьте в PATH:**

   - Win + R → `sysdm.cpl` → Enter
   - Вкладка "Дополнительно" → "Переменные среды"
   - В "Системные переменные" найдите `Path` → "Изменить"
   - "Создать" → добавьте: `C:\ffmpeg\bin`
   - Нажмите OK везде

4. **Проверьте:**
   - Закройте и откройте новый терминал
   - Выполните:
     ```powershell
     ffmpeg -version
     ```
   - Должно вывести информацию о версии FFmpeg

### Вариант C: Через winget (Windows 10/11)

```powershell
winget install FFmpeg
```

---

## Шаг 3: Установка Demucs

⚠️ **Перед установкой проверьте версию Python:**

```powershell
python --version
```

Должно быть: `Python 3.8.x` или выше

После установки Python 3.8+ и FFmpeg:

1. **Откройте PowerShell или Command Prompt**

2. **Установите Demucs:**

   ```powershell
   pip install demucs
   ```

   Если `pip` не найден, попробуйте:

   ```powershell
   python -m pip install demucs
   ```

   Или:

   ```powershell
   python3 -m pip install demucs
   ```

3. **Проверьте установку:**

   ```powershell
   demucs --help
   ```

   Должно вывести справку по командам Demucs

4. **Проверьте через скрипт проекта:**
   ```powershell
   npm run check:demucs
   ```

---

## Проверка всей установки

Выполните все команды по порядку:

```powershell
# Проверка Python
python --version
# Должно быть: Python 3.8.x до 3.11.x (НЕ 3.12+!)

# Проверка pip
pip --version
# Должно вывести версию pip

# Проверка FFmpeg
ffmpeg -version
# Должно вывести информацию о FFmpeg

# Проверка Demucs
demucs --help
# Должно вывести справку

# Проверка через проект
npm run check:demucs
# Должно вывести: ✅ Demucs is installed and available
```

---

## Решение проблем

### Python не найден в терминале

**Решение:**

1. Переустановите Python с галочкой "Add Python to PATH"
2. Или добавьте вручную в PATH (см. выше)
3. **Перезапустите терминал** после изменения PATH

### pip не найден

**Решение:**

```powershell
python -m ensurepip --upgrade
python -m pip install --upgrade pip
```

### FFmpeg не найден

**Решение:**

1. Убедитесь, что добавили `C:\ffmpeg\bin` в PATH
2. Перезапустите терминал
3. Проверьте, что файл `ffmpeg.exe` существует в указанной папке

### Demucs не устанавливается

**Решение:**

```powershell
# Обновите pip
python -m pip install --upgrade pip

# Установите Demucs снова
pip install demucs

# Если ошибка с зависимостями, попробуйте:
pip install demucs --no-cache-dir
```

### Ошибка "Microsoft Visual C++ 14.0 is required"

**Решение:**

1. Скачайте и установите: https://visualstudio.microsoft.com/visual-cpp-build-tools/
2. Или установите через Chocolatey: `choco install visualcpp-build-tools -y`

---

## Быстрая установка (все сразу через Chocolatey)

Если у вас установлен Chocolatey, можно установить все одной командой:

```powershell
# Откройте PowerShell от имени администратора
choco install python ffmpeg -y

# Затем установите Demucs
pip install demucs
```

---

## После установки

1. **Примените миграции БД:**

   ```powershell
   npm run db:push
   ```

2. **Проверьте установку:**

   ```powershell
   npm run check:demucs
   ```

3. **Откройте админ-панель:**
   - Запустите: `npm run dev`
   - Перейдите на: http://localhost:3000/admin/upload

Готово! Теперь можно загружать и обрабатывать треки через Demucs.
