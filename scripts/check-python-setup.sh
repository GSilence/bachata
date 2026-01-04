#!/bin/bash
# Скрипт для проверки настройки Python и библиотек на сервере

echo "=== Проверка Python окружения ==="
echo ""

# Проверка .env.local
echo "1. Проверка .env.local:"
if [ -f "/opt/bachata/.env.local" ]; then
    echo "✓ .env.local найден"
    echo "DEMUCS_PYTHON_PATH:"
    grep DEMUCS_PYTHON_PATH /opt/bachata/.env.local || echo "  ⚠ Не найден!"
else
    echo "✗ .env.local не найден!"
fi
echo ""

# Проверка Python
echo "2. Проверка Python:"
PYTHON_PATH=$(grep DEMUCS_PYTHON_PATH /opt/bachata/.env.local 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "/opt/bachata/venv/bin/python")
echo "Путь к Python: $PYTHON_PATH"

if [ -f "$PYTHON_PATH" ]; then
    echo "✓ Python найден"
    $PYTHON_PATH --version
else
    echo "✗ Python не найден по пути: $PYTHON_PATH"
fi
echo ""

# Проверка библиотек
echo "3. Проверка установленных библиотек:"
if [ -f "$PYTHON_PATH" ]; then
    echo "Проверка madmom:"
    $PYTHON_PATH -c "import madmom; print('✓ madmom установлен')" 2>&1 || echo "✗ madmom НЕ установлен"
    
    echo "Проверка demucs:"
    $PYTHON_PATH -c "import demucs; print('✓ demucs установлен')" 2>&1 || echo "✗ demucs НЕ установлен"
    
    echo "Проверка librosa:"
    $PYTHON_PATH -c "import librosa; print('✓ librosa установлен')" 2>&1 || echo "✗ librosa НЕ установлен"
else
    echo "⚠ Python не найден, пропускаем проверку библиотек"
fi
echo ""

# Проверка скриптов
echo "4. Проверка Python скриптов:"
if [ -f "/opt/bachata/scripts/analyze-track.py" ]; then
    echo "✓ analyze-track.py найден"
else
    echo "✗ analyze-track.py НЕ найден!"
fi

if [ -f "/opt/bachata/scripts/analyze-bpm-offset.py" ]; then
    echo "✓ analyze-bpm-offset.py найден"
else
    echo "✗ analyze-bpm-offset.py НЕ найден!"
fi
echo ""

# Проверка прав доступа
echo "5. Проверка прав доступа:"
ls -la /opt/bachata/venv/bin/python 2>/dev/null || echo "⚠ Не удалось проверить права"
ls -la /opt/bachata/scripts/analyze-track.py 2>/dev/null || echo "⚠ Не удалось проверить права"
echo ""

# Тестовый запуск скрипта (если есть тестовый файл)
echo "6. Тестовый запуск (если есть тестовый файл):"
TEST_FILE=$(find /opt/bachata/public -name "*.mp3" -type f | head -1)
if [ -n "$TEST_FILE" ]; then
    echo "Тестовый файл: $TEST_FILE"
    if [ -f "$PYTHON_PATH" ] && [ -f "/opt/bachata/scripts/analyze-track.py" ]; then
        echo "Запуск анализа (может занять время)..."
        timeout 30 "$PYTHON_PATH" "/opt/bachata/scripts/analyze-track.py" "$TEST_FILE" 2>&1 | head -20
    fi
else
    echo "⚠ Тестовый файл не найден"
fi

