#!/usr/bin/env python3
"""
Простой скрипт для текстового вывода результатов анализа madmom
Использование: python scripts/print-madmom-results.py path/to/audio.mp3
"""

import sys
import json
import subprocess
import os
import argparse
from pathlib import Path

def main():
    
    parser = argparse.ArgumentParser(
        description='Print madmom analysis results in text format',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic usage
  python scripts/print-madmom-results.py audio.mp3
  
  # Show all beats (not just first 20)
  python scripts/print-madmom-results.py audio.mp3 --all-beats
        """
    )
    parser.add_argument('audio_file', help='Path to audio file to analyze')
    parser.add_argument('--all-beats', action='store_true', 
                       help='Show all beats (default: show first 20)')
    
    args = parser.parse_args()
    audio_path = args.audio_file
    
    if not os.path.exists(audio_path):
        print(f"Error: File not found: {audio_path}", file=sys.stderr)
        sys.exit(1)
    
    # Получаем путь к скрипту анализа
    script_dir = os.path.dirname(os.path.abspath(__file__))
    analyze_script = os.path.join(script_dir, 'analyze-track.py')
    
    # Используем тот же Python, что запустил этот скрипт
    python_executable = sys.executable
    
    print("=" * 80)
    print("MADMOM ANALYSIS - Text Output")
    print("=" * 80)
    print(f"Audio file: {audio_path}")
    print(f"File size: {os.path.getsize(audio_path) / (1024*1024):.2f} MB")
    print()
    
    # Запускаем анализ
    print("Running analysis...")
    print("-" * 80)
    
    try:
        result = subprocess.run(
            [python_executable, analyze_script, audio_path],
            capture_output=True,
            text=True,
            env=os.environ.copy()
        )
        
        # Выводим stderr (подробная информация о процессе)
        if result.stderr:
            print(result.stderr)
        
        # Парсим JSON результат
        if result.returncode == 0 and result.stdout:
            try:
                analysis_result = json.loads(result.stdout)
                
                print()
                print("=" * 80)
                print("ANALYSIS RESULTS (JSON):")
                print("=" * 80)
                print(json.dumps(analysis_result, indent=2, ensure_ascii=False))
                
                # Дополнительная информация
                print()
                print("=" * 80)
                print("SUMMARY:")
                print("=" * 80)
                print(f"BPM: {analysis_result.get('bpm', 'N/A')}")
                print(f"Offset: {analysis_result.get('offset', 'N/A')}s")
                print(f"Duration: {analysis_result.get('duration', 'N/A')}s")
                
                grid = analysis_result.get('grid', [])
                if grid:
                    print(f"\nGrid sections: {len(grid)}")
                    verse_sections = [s for s in grid if s.get('type') == 'verse']
                    bridge_sections = [s for s in grid if s.get('type') == 'bridge']
                    print(f"  - Verse: {len(verse_sections)}")
                    print(f"  - Bridge: {len(bridge_sections)}")
                    
                    print("\nAll grid sections:")
                    for i, section in enumerate(grid, 1):
                        section_type = section.get('type', 'unknown').upper()
                        start = section.get('start', 0)
                        beats = section.get('beats', 0)
                        beat_duration = 60.0 / analysis_result.get('bpm', 120)
                        end = start + (beats * beat_duration)
                        print(f"  [{i:2d}] {section_type:6s} | "
                              f"Start: {start:7.3f}s | "
                              f"Beats: {beats:3d} | "
                              f"End: {end:7.3f}s | "
                              f"Duration: {beats * beat_duration:6.2f}s")
                    
                    if bridge_sections:
                        print("\nBridge sections (detailed):")
                        for i, section in enumerate(bridge_sections, 1):
                            print(f"  [{i}] Start: {section['start']:.3f}s, Beats: {section['beats']}")
                else:
                    print("\nGrid: No grid data")
                
                # Если есть beats в результате, выводим их
                beats = analysis_result.get('beats', [])
                if beats:
                    print(f"\nBeats array: {len(beats)} beats")
                    beats_to_show = beats if args.all_beats else beats[:20]
                    print(f"{'All' if args.all_beats else 'First 20'} beats:")
                    for i, beat in enumerate(beats_to_show, 1):
                        time = beat.get('time', 0)
                        number = beat.get('number', 0)
                        print(f"  [{i:2d}] Time: {time:7.3f}s | Number: {number}")
                    if not args.all_beats and len(beats) > 20:
                        print(f"  ... and {len(beats) - 20} more beats (use --all-beats to see all)")
                
            except json.JSONDecodeError as e:
                print(f"Error parsing JSON: {e}", file=sys.stderr)
                print("Raw output:", file=sys.stderr)
                print(result.stdout, file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Analysis failed with return code: {result.returncode}", file=sys.stderr)
            if result.stdout:
                print("Output:", file=sys.stderr)
                print(result.stdout, file=sys.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"Error running analysis: {e}", file=sys.stderr)
        sys.exit(1)
    
    print()
    print("=" * 80)
    print("Analysis complete!")
    print("=" * 80)

if __name__ == '__main__':
    main()

