#!/usr/bin/env python3
"""
Переименование треков в uploads/test/tracks/ по манифесту.
Манифест: CSV с колонками id, title, artist, pathOriginal, report_filename.
Новое имя файла: "Artist - Title.mp3" или "Title.mp3", если artist пустой.
"""
import csv
import os
import re
import sys

def sanitize_filename(s: str) -> str:
    """Убираем символы, недопустимые в имени файла Windows."""
    s = s.strip()
    for c in r'\/:*?"<>|':
        s = s.replace(c, "")
    s = re.sub(r'\s+', ' ', s)
    return s.strip() or "unnamed"

def main():
    base = os.path.join(os.path.dirname(__file__), "..", "public", "uploads", "test")
    if len(sys.argv) > 1:
        base = os.path.abspath(sys.argv[1])

    manifest_path = None
    for name in os.listdir(base):
        if name.endswith(".csv") and "manifest" in name.lower():
            manifest_path = os.path.join(base, name)
            break
    if not manifest_path:
        print("Манифест (CSV) не найден в", base, file=sys.stderr)
        sys.exit(1)

    tracks_dir = os.path.join(base, "tracks")
    if not os.path.isdir(tracks_dir):
        print("Папка tracks не найдена:", tracks_dir, file=sys.stderr)
        sys.exit(1)

    # pathOriginal -> (title, artist)
    mapping = {}
    with open(manifest_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            path_orig = (row.get("pathOriginal") or "").strip()
            if not path_orig:
                continue
            # basename: UUID.mp3
            filename = os.path.basename(path_orig.replace("\\", "/"))
            title = (row.get("title") or "").strip()
            artist = (row.get("artist") or "").strip()
            mapping[filename] = (title, artist)

    # Собираем новые имена и избегаем дубликатов
    used_names = set()
    renames = []  # (old_path, new_name)

    for filename in sorted(os.listdir(tracks_dir)):
        path = os.path.join(tracks_dir, filename)
        if not os.path.isfile(path):
            continue
        if filename not in mapping:
            print("Пропуск (нет в манифесте):", filename)
            continue
        title, artist = mapping[filename]
        if artist:
            base_name = sanitize_filename(artist) + " - " + sanitize_filename(title)
        else:
            base_name = sanitize_filename(title) or "unnamed"
        ext = os.path.splitext(filename)[1]
        new_name = base_name + ext
        # Уникальность
        while new_name in used_names:
            base_name = base_name.rstrip(")")
            if re.search(r" \(\d+$", base_name):
                base_name = re.sub(r" \(\d+$", "", base_name)
            idx = sum(1 for n in used_names if n.startswith(base_name) and n.endswith(ext))
            new_name = f"{base_name} ({idx + 1}){ext}"
        used_names.add(new_name)
        renames.append((path, os.path.join(tracks_dir, new_name), new_name))

    for old_path, new_path, new_name in renames:
        if old_path == new_path:
            continue
        if os.path.exists(new_path):
            print("Уже существует, пропуск:", new_name)
            continue
        try:
            os.rename(old_path, new_path)
            print(os.path.basename(old_path), "->", new_name)
        except Exception as e:
            print("Ошибка:", old_path, e, file=sys.stderr)

    print("Готово. Переименовано файлов:", len(renames))

if __name__ == "__main__":
    main()
