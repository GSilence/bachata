#!/usr/bin/env python3
"""
Анализ rolloff и zcr по файлу sherlock JSON.
Считает диапазон, среднее, распределение относительно среднего и метрики.
"""

import json
import sys
from pathlib import Path

def load_beats(path: str) -> list:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("beats", [])

def extract_series(beats: list, key: str) -> list:
    out = []
    for b in beats:
        es = b.get("energy_stats") or {}
        v = es.get(key)
        if v is not None:
            out.append(float(v))
    return out

def stats(name: str, vals: list) -> dict:
    if not vals:
        return {}
    n = len(vals)
    s = sum(vals)
    mean = s / n
    variance = sum((x - mean) ** 2 for x in vals) / n
    std = variance ** 0.5 if variance else 0.0
    sorted_vals = sorted(vals)
    mid = n // 2
    median = (sorted_vals[mid - 1] + sorted_vals[mid]) / 2 if n % 2 == 0 else sorted_vals[mid]

    above = sum(1 for x in vals if x > mean)
    below = sum(1 for x in vals if x < mean)
    at_mean = sum(1 for x in vals if x == mean)

    # Процентили
    def percentile(p: float) -> float:
        k = (n - 1) * p / 100
        f = int(k)
        c = f + 1 if f + 1 < n else f
        return sorted_vals[f] + (k - f) * (sorted_vals[c] - sorted_vals[f]) if c > f else sorted_vals[f]

    return {
        "name": name,
        "n": n,
        "min": min(vals),
        "max": max(vals),
        "mean": mean,
        "median": median,
        "std": std,
        "above_mean": above,
        "below_mean": below,
        "at_mean": at_mean,
        "p25": percentile(25),
        "p75": percentile(75),
        "p10": percentile(10),
        "p90": percentile(90),
    }

def z_score(x: float, mean: float, std: float) -> float:
    """Стандартизованное отклонение: сколько сигм от среднего. 0 = среднее."""
    if std == 0:
        return 0.0
    return (x - mean) / std

def norm_01(x: float, lo: float, hi: float) -> float:
    """Нормализация в [0, 1] по диапазону min–max."""
    if hi <= lo:
        return 0.5
    return (x - lo) / (hi - lo)

def main():
    path = Path(__file__).resolve().parent.parent / "public/uploads/test/Buscando una Nena_sherlock_v2.09.json"
    out_path = None
    if len(sys.argv) > 1:
        if sys.argv[1] == "-o" and len(sys.argv) > 2:
            out_path = Path(sys.argv[2])
        else:
            path = Path(sys.argv[1])

    beats = load_beats(path)
    rolloff = extract_series(beats, "rolloff")
    zcr = extract_series(beats, "zcr")

    r = stats("rolloff", rolloff)
    z = stats("zcr", zcr)

    lines: list[str] = []

    def out(t: str = ""):
        lines.append(t)
        print(t)

    def print_block(title: str, s: dict, raw: list):
        if not s:
            return
        out(title)
        out("-" * 60)
        out(f"  Количество:      {s['n']}")
        out(f"  Мин:            {s['min']:.6f}")
        out(f"  Макс:           {s['max']:.6f}")
        out(f"  Среднее:        {s['mean']:.6f}")
        out(f"  Медиана:        {s['median']:.6f}")
        out(f"  Стд. откл.:     {s['std']:.6f}")
        out(f"  P10 / P90:      {s['p10']:.6f}  /  {s['p90']:.6f}")
        out(f"  P25 / P75:      {s['p25']:.6f}  /  {s['p75']:.6f}")
        out(f"  Выше среднего:  {s['above_mean']}  ({100*s['above_mean']/s['n']:.1f}%)")
        out(f"  Ниже среднего:  {s['below_mean']}  ({100*s['below_mean']/s['n']:.1f}%)")
        out(f"  Равны среднему: {s['at_mean']}")
        out()

    print_block("=== ROLLOFF ===", r, rolloff)
    print_block("=== ZCR ===", z, zcr)

    # Удобная метрика: z-score и нормализация [0,1]
    out("=== МЕТРИКИ ДЛЯ ИНТЕРПРЕТАЦИИ ===")
    out()
    out("1) Z-SCORE (стандартизованное отклонение):")
    out("   z = (x - mean) / std")
    out("   * 0 ~ среднее, +1 = на 1 сигму выше, -1 = на 1 сигму ниже")
    out("   * |z| < 0.5 обычно считают «близко к среднему»")
    out()
    out("2) Нормализация в [0, 1] по мин–макс:")
    out("   norm = (x - min) / (max - min); 0.5 = середина диапазона")
    out()
    out("3) Близость к среднему: dist_std = |x - mean| / std (чем меньше — тем ближе)")
    out()

    # Пример по первому десятку битов
    out("=== ПРИМЕР: первые 10 битов (rolloff, zcr) ===")
    for i, b in enumerate(beats[:10]):
        es = b.get("energy_stats") or {}
        ro, zc = es.get("rolloff"), es.get("zcr")
        if ro is None and zc is None:
            continue
        z_ro = z_score(ro, r["mean"], r["std"]) if ro is not None and r["std"] else 0
        z_zc = z_score(zc, z["mean"], z["std"]) if zc is not None and z["std"] else 0
        n_ro = norm_01(ro, r["min"], r["max"]) if ro is not None else 0
        n_zc = norm_01(zc, z["min"], z["max"]) if zc is not None else 0
        out(f"  beat {i}: rolloff={ro:.4f} (z={z_ro:+.2f}, norm={n_ro:.3f})  zcr={zc:.4f} (z={z_zc:+.2f}, norm={n_zc:.3f})")

    # Сводка: сколько битов «близко к среднему» по |z| < 0.5
    if r["std"] > 0:
        near_ro = sum(1 for x in rolloff if abs(z_score(x, r["mean"], r["std"])) < 0.5)
        out()
        out(f"  Rolloff: битов с |z| < 0.5 (близко к среднему): {near_ro} из {len(rolloff)} ({100*near_ro/len(rolloff):.1f}%)")
    if z["std"] > 0:
        near_zc = sum(1 for x in zcr if abs(z_score(x, z["mean"], z["std"])) < 0.5)
        out(f"  ZCR:     битов с |z| < 0.5 (близко к среднему): {near_zc} из {len(zcr)} ({100*near_zc/len(zcr):.1f}%)")

    if out_path:
        out_path.write_text("\n".join(lines), encoding="utf-8")
        print(f"\nReport written to {out_path}", flush=True)

if __name__ == "__main__":
    main()
