#!/usr/bin/env python3
"""
Скрипт для нормализации и усиления громкости голосовых файлов.
Нормализует файлы (поднимает пики до максимума) и при необходимости добавляет дополнительное усиление.
"""

import os
import sys
from pathlib import Path

try:
    from pydub import AudioSegment
    from pydub.effects import normalize
except ImportError:
    print("Ошибка: pydub не установлен. Установите его командой:")
    print("  pip install pydub")
    sys.exit(1)


def boost_volume(folder_path, gain_db=0, backup=True, output_suffix=""):
    """
    Нормализует и усиливает громкость аудио файлов.
    
    Args:
        folder_path: Путь к папке с аудио файлами
        gain_db: Дополнительное усиление в децибелах (аккуратно, может быть перегруз)
        backup: Создавать ли резервную копию оригиналов
        output_suffix: Суффикс для выходных файлов (если пусто, заменяет оригиналы)
    """
    folder = Path(folder_path)
    
    if not folder.exists():
        print(f"Ошибка: Папка {folder_path} не существует!")
        return
    
    # Создаем папку для бэкапа, если нужно
    if backup:
        backup_folder = folder / "backup_original"
        backup_folder.mkdir(exist_ok=True)
        print(f"Резервные копии будут сохранены в: {backup_folder}")
    
    # Обрабатываем все аудио файлы
    audio_files = list(folder.glob("*.mp3")) + list(folder.glob("*.wav"))
    
    if not audio_files:
        print(f"В папке {folder_path} не найдено аудио файлов (.mp3, .wav)")
        return
    
    print(f"Найдено {len(audio_files)} аудио файлов для обработки")
    print(f"Нормализация: включена")
    print(f"Дополнительное усиление: {gain_db} dB")
    print("-" * 50)
    
    for filepath in audio_files:
        filename = filepath.name
        print(f"Обработка: {filename}...", end=" ", flush=True)
        
        try:
            # Загружаем аудио файл
            audio = AudioSegment.from_file(str(filepath))
            
            # Создаем резервную копию, если нужно
            if backup:
                backup_path = backup_folder / filename
                audio.export(str(backup_path), format="mp3")
            
            # 1. Нормализация (поднимает самый громкий пик до 0 dB)
            # Это безопасно, искажений не будет
            normalized_audio = normalize(audio)
            
            # 2. Дополнительное усиление, если указано
            # Внимание: может появиться "хрип" (clipping) при больших значениях
            if gain_db > 0:
                normalized_audio = normalized_audio + gain_db
            
            # Определяем путь для сохранения
            if output_suffix:
                # Сохраняем с суффиксом
                output_path = folder / f"{filepath.stem}{output_suffix}{filepath.suffix}"
            else:
                # Заменяем оригинал
                output_path = filepath
            
            # Сохраняем обработанный файл
            normalized_audio.export(str(output_path), format="mp3", bitrate="192k")
            
            print("✓ Готово")
            
        except Exception as e:
            print(f"✗ Ошибка: {e}")
            continue
    
    print("-" * 50)
    print("Обработка завершена!")


if __name__ == "__main__":
    # Путь к папке с голосовыми файлами
    # Относительно корня проекта
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    voice_folder = project_root / "public" / "audio" / "voice"
    
    # Параметры обработки
    # gain_db: Дополнительное усиление в децибелах
    # Рекомендуемые значения: 0-6 dB (больше может вызвать искажения)
    # Для увеличения на 250% можно попробовать 3-6 dB
    GAIN_DB = 3  # Можно изменить на нужное значение
    
    # Создавать ли резервные копии оригиналов
    CREATE_BACKUP = True
    
    print("=" * 50)
    print("Нормализация и усиление голосовых файлов")
    print("=" * 50)
    print(f"Папка: {voice_folder}")
    print()
    
    # Запрашиваем подтверждение
    if CREATE_BACKUP:
        print("Внимание: Будет создана резервная копия оригинальных файлов.")
    else:
        response = input("Внимание: Оригинальные файлы будут заменены! Продолжить? (yes/no): ")
        if response.lower() != "yes":
            print("Отменено.")
            sys.exit(0)
    
    print()
    
    # Запускаем обработку
    boost_volume(
        folder_path=str(voice_folder),
        gain_db=GAIN_DB,
        backup=CREATE_BACKUP,
        output_suffix=""  # Заменяем оригиналы (если backup=True, оригиналы сохранены)
    )

