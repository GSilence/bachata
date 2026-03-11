#!/usr/bin/env python3
"""
lookup-metadata.py — Lookup track metadata via AcoustID + MusicBrainz.

Pipeline:
  1. Generate compressed fingerprint via fpcalc (through pyacoustid)
  2. Query AcoustID API → get recording MBID + confidence score
  3. Query MusicBrainz API → get full metadata (artist, title, year, genre, album, ISRC)

Usage:
    python lookup-metadata.py <audio_path> [--fpcalc <path>] [--key <acoustid_key>]

Output (stdout):
    JSON: { "found": true|false, "results": [...], "best": {...} | null }

Environment:
    ACOUSTID_API_KEY  — AcoustID application key (https://acoustid.org/)
    FPCALC            — path to fpcalc binary (acoustid env var name)
    FPCALC_PATH       — alternative path to fpcalc binary
"""

import sys
import os
import json
import argparse
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio_path")
    parser.add_argument("--fpcalc", default=None, help="Path to fpcalc binary")
    parser.add_argument("--key", default=None, help="AcoustID API key (overrides env)")
    args = parser.parse_args()

    api_key = args.key or os.environ.get("ACOUSTID_API_KEY", "")
    if not api_key:
        print(json.dumps({"error": "ACOUSTID_API_KEY not set"}))
        sys.exit(1)

    try:
        import acoustid
    except ImportError:
        print(json.dumps({"error": "pyacoustid not installed. Run: pip install pyacoustid"}))
        sys.exit(1)

    try:
        import musicbrainzngs as mbz
    except ImportError:
        print(json.dumps({"error": "musicbrainzngs not installed. Run: pip install musicbrainzngs"}))
        sys.exit(1)

    # Set fpcalc path: --fpcalc arg > FPCALC env > FPCALC_PATH env
    fpcalc_path = (
        args.fpcalc
        or os.environ.get("FPCALC")
        or os.environ.get("FPCALC_PATH")
    )
    if fpcalc_path:
        acoustid.FPCALC_COMMAND = fpcalc_path
        print(f"[AcoustID] Using fpcalc: {fpcalc_path}", file=sys.stderr)

    # Configure MusicBrainz (required User-Agent)
    mbz.set_useragent("BachataAnalyzer", "1.0", "https://github.com/bachata-analyzer")
    mbz.set_rate_limit(True)

    # ── Step 1: AcoustID lookup ──────────────────────────────────────────────
    print(f"[AcoustID] Generating fingerprint for: {args.audio_path}", file=sys.stderr)

    try:
        raw_results = list(acoustid.match(
            api_key,
            args.audio_path,
            meta=["recordings", "releases", "tracks"],
            parse=False,
        ))
    except acoustid.NoBackendError:
        print(json.dumps({"error": "fpcalc not found. Set FPCALC_PATH env var or pass --fpcalc."}))
        sys.exit(1)
    except acoustid.FingerprintGenerationError as e:
        print(json.dumps({"error": f"Fingerprint generation failed: {e}"}))
        sys.exit(1)
    except acoustid.WebServiceError as e:
        print(json.dumps({"error": f"AcoustID API error: {e}"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": f"Unexpected error during lookup: {type(e).__name__}: {e}"}))
        sys.exit(1)

    if not raw_results:
        print(json.dumps({"found": False, "results": [], "best": None,
                          "message": "No matches in AcoustID database"}))
        return

    # ── Step 2: Parse AcoustID results ──────────────────────────────────────
    candidates = []

    for result in raw_results:
        score = result.get("score", 0)
        for recording in result.get("recordings", []):
            mbid = recording.get("id")
            title = recording.get("title", "")
            artists = recording.get("artists", [])
            artist_name = ", ".join(a.get("name", "") for a in artists)

            releases = recording.get("releases", [])
            album = None
            year = None
            if releases:
                rel = releases[0]
                album = rel.get("title")
                date = rel.get("date", {})
                if isinstance(date, dict):
                    year = date.get("year")
                elif isinstance(date, str) and len(date) >= 4:
                    try:
                        year = int(date[:4])
                    except ValueError:
                        pass

            candidates.append({
                "score": round(score, 4),
                "confidence_pct": round(score * 100, 1),
                "mbid": mbid,
                "title": title,
                "artist": artist_name,
                "album": album,
                "year": year,
            })

    candidates.sort(key=lambda x: x["score"], reverse=True)

    # ── Step 3: Enrich best match via MusicBrainz ────────────────────────────
    best = candidates[0] if candidates else None
    enriched = None

    if best and best["mbid"] and best["score"] >= 0.70:
        print(f"[MusicBrainz] Fetching details for MBID: {best['mbid']} ({best['confidence_pct']}%)",
              file=sys.stderr)
        time.sleep(1)

        try:
            mb_result = mbz.get_recording_by_id(
                best["mbid"],
                includes=["artists", "releases", "tags", "isrcs"],
            )
            recording = mb_result.get("recording", {})

            tags = [t["name"] for t in recording.get("tag-list", [])]
            isrcs = recording.get("isrc-list", [])

            release_list = recording.get("release-list", [])
            mb_album = None
            mb_year = None
            mb_label = None
            if release_list:
                rel = release_list[0]
                mb_album = rel.get("title")
                mb_date = rel.get("date", "")
                if mb_date and len(mb_date) >= 4:
                    try:
                        mb_year = int(mb_date[:4])
                    except ValueError:
                        pass
                label_info = rel.get("label-info-list", [])
                if label_info:
                    mb_label = label_info[0].get("label", {}).get("name")

            enriched = {
                **best,
                "tags": tags[:10],
                "isrcs": isrcs[:3],
                "album": mb_album or best.get("album"),
                "year": mb_year or best.get("year"),
                "label": mb_label,
                "musicbrainz_url": f"https://musicbrainz.org/recording/{best['mbid']}",
            }

        except Exception as e:
            print(f"[MusicBrainz] Warning: {e}", file=sys.stderr)
            enriched = best

    output = {
        "found": len(candidates) > 0,
        "results": candidates[:5],
        "best": enriched or best,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
