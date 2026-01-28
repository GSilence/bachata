#!/usr/bin/env python3
"""
Проверка наложения квадратов (сетки 1-8) по sherlock JSON.
Старт = start_time / start_beat_id. Позиции 1 и 5 = каждые 4 бита от старта.
Считаем Hit Rate на позициях 1 и 5 (madmom > 0.3 или bass > 0.45) по всему треку
и сравниваем все 8 возможных смещений.
"""

import json
import sys
from pathlib import Path

MADMOM_THRESH = 0.30
BASS_THRESH = 0.45


def load_sherlock(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def run_check(path: str, out_path: str = None):
    data = load_sherlock(path)
    beats = data.get("beats", [])
    verdict = data.get("verdict", {})
    start_id = verdict.get("start_beat_id", 0)
    start_time = verdict.get("start_time", 0.0)
    algo = verdict.get("algo_version", "?")

    lines = []
    def out(s: str = ""):
        lines.append(s)
        print(s)

    out(f"File: {path}")
    out(f"Verdict: start_beat_id={start_id}, start_time={start_time}s ({algo})")
    out(f"Total beats: {len(beats)}")
    out("")

    if not beats:
        return

    # Для каждого смещения 0..7: позиции "1 и 5" = offset, offset+4, offset+8, ...
    total_beats = len(beats)
    candidates = []

    for offset in range(8):
        grid_indices = list(range(offset, total_beats, 4))
        hits = 0
        total_madmom = 0.0
        total_bass = 0.0
        sample_hits = []
        sample_misses = []

        for idx in grid_indices:
            b = beats[idx]
            m = b.get("madmom_score_1") or 0
            low = (b.get("energy_stats") or {}).get("low") or 0
            t = b.get("time", 0)

            total_madmom += m
            total_bass += low
            is_hit = m > MADMOM_THRESH or low > BASS_THRESH
            if is_hit:
                hits += 1
                if len(sample_hits) < 5:
                    sample_hits.append((idx, t, m, low))
            else:
                if len(sample_misses) < 5:
                    sample_misses.append((idx, t, m, low))

        n = len(grid_indices)
        pct = (100.0 * hits / n) if n else 0
        avg_m = (total_madmom / n) if n else 0
        avg_b = (total_bass / n) if n else 0

        candidates.append({
            "offset": offset,
            "match_pct": pct,
            "hits": hits,
            "total": n,
            "avg_madmom": avg_m,
            "avg_bass": avg_b,
            "sample_hits": sample_hits,
            "sample_misses": sample_misses,
        })

    # Сортировка: выше % — лучше; при равенстве — меньший offset
    candidates.sort(key=lambda x: (-x["match_pct"], x["offset"]))
    best = candidates[0]
    declared = next((c for c in candidates if c["offset"] == start_id), None)

    out("=== Наложение сетки: позиции 1 и 5 (каждые 4 бита) ===")
    out("Критерий попадания: madmom_score_1 > 0.30 ИЛИ energy_stats.low > 0.45")
    out("")
    out("Все 8 смещений (offset = какой бит считать «1»):")
    out("-" * 70)
    for c in candidates:
        mark = " <-- VERDICT" if c["offset"] == start_id else (" <-- BEST" if c["offset"] == best["offset"] else "")
        out(f"  offset {c['offset']}: {c['match_pct']:.1f}% ({c['hits']}/{c['total']})  avg_madmom={c['avg_madmom']:.3f}  avg_bass={c['avg_bass']:.3f}{mark}")
    out("")

    # Вердикт корректен?
    if declared:
        if best["offset"] == start_id:
            out(">>> Вывод: старт с beat_id {} (время {:.2f}s) совпадает с лучшим смещением по Hit Rate. Наложение квадратов по 1 и 5 — оптимально.".format(start_id, start_time))
        else:
            out(">>> Внимание: лучший Hit Rate даёт offset {}, а в вердикте старт = beat_id {} (offset {}).".format(best["offset"], start_id, start_id))
            out("    Разница в Hit Rate: {:.1f}% vs {:.1f}%.".format(best["match_pct"], declared["match_pct"]))
    out("")

    # Примеры попаданий/промахов для выбранного старта
    if declared:
        out("Примеры попаданий на позициях 1 и 5 (при старте с beat_id {}):".format(start_id))
        for idx, t, m, low in declared["sample_hits"][:8]:
            out("  beat_id {:4d}  t={:7.2f}s  madmom={:.3f}  bass={:.3f}".format(idx, t, m, low))
        out("")
        out("Примеры промахов на позициях 1 и 5:")
        for idx, t, m, low in declared["sample_misses"][:8]:
            out("  beat_id {:4d}  t={:7.2f}s  madmom={:.3f}  bass={:.3f}".format(idx, t, m, low))

    if out_path:
        # Убрать скобки, если пользователь скопировал путь в [ ]
        p = out_path.strip()
        if p.startswith("[") and p.endswith("]"):
            p = p[1:-1]
        out_file = Path(p)
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text("\n".join(lines), encoding="utf-8")
        print(f"\nReport: {out_file}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        default = Path(__file__).resolve().parent.parent / "public/uploads/test/Raulin_Rodriguez_-_Cancion_del_Corazon_sherlock_v2.09.json"
        run_check(str(default), "docs/grid-overlay-raulin.txt")
    else:
        path = sys.argv[1]
        out = sys.argv[2].strip() if len(sys.argv) > 2 else None
        if out and out.startswith("[") and out.endswith("]"):
            out = out[1:-1]
        run_check(path, out)
