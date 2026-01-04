#!/usr/bin/env python3
"""
Визуализация результатов анализа madmom для разработки
Создает HTML файл с визуализацией beats, downbeats и grid

Использование:
    # Визуализировать результат анализа (запустит анализ автоматически)
    python scripts/visualize_madmom.py path/to/audio.mp3
    
    # Визуализировать из сохраненного JSON файла
    python scripts/visualize_madmom.py path/to/audio.mp3 --analysis-json result.json
    
    # Указать выходной файл
    python scripts/visualize_madmom.py path/to/audio.mp3 -o visualization.html
"""

import sys
import json
import argparse
from pathlib import Path

# Применяем патчи для совместимости (ДО импорта madmom!)
import os
import collections
import collections.abc

# Патч 1: Python 3.10+ - добавляем обратную совместимость для collections
if sys.version_info >= (3, 10):
    if not hasattr(collections, 'MutableSequence'):
        collections.MutableSequence = collections.abc.MutableSequence
    if not hasattr(collections, 'MutableMapping'):
        collections.MutableMapping = collections.abc.MutableMapping
    if not hasattr(collections, 'Mapping'):
        collections.Mapping = collections.abc.Mapping
    if not hasattr(collections, 'Sequence'):
        collections.Sequence = collections.abc.Sequence
    if not hasattr(collections, 'Iterable'):
        collections.Iterable = collections.abc.Iterable
    if not hasattr(collections, 'Iterator'):
        collections.Iterator = collections.abc.Iterator
    if not hasattr(collections, 'Callable'):
        collections.Callable = collections.abc.Callable

# Патч 2: NumPy 1.20+ - добавляем обратную совместимость для np.float, np.int, np.bool
# Импортируем numpy ДО применения патча, чтобы избежать предупреждений
import numpy as np
import warnings

# Подавляем предупреждение о np.bool
with warnings.catch_warnings():
    warnings.simplefilter("ignore", FutureWarning)
    if not hasattr(np, 'float'):
        np.float = np.float64
    if not hasattr(np, 'int'):
        np.int = np.int64
    if not hasattr(np, 'bool'):
        np.bool = np.bool_
    if not hasattr(np, 'complex'):
        np.complex = np.complex128

def create_visualization_html(audio_path, analysis_result, output_path):
    """
    Создает HTML файл с визуализацией результатов анализа
    """
    
    # Извлекаем данные из результата
    bpm = analysis_result.get('bpm', 120)
    offset = analysis_result.get('offset', 0.0)
    duration = analysis_result.get('duration', 180)
    beats = analysis_result.get('beats', [])
    grid = analysis_result.get('grid', [])
    
    # Если duration не указан, вычисляем из grid или используем дефолт
    if duration == 180 and grid:
        # Вычисляем duration из последней секции grid
        last_section = grid[-1] if grid else None
        if last_section:
            beat_duration = 60.0 / bpm
            duration = last_section['start'] + (last_section['beats'] * beat_duration)
    
    # Подготавливаем данные для визуализации
    beats_js = json.dumps(beats)
    grid_js = json.dumps(grid)
    
    # Извлекаем downbeats из beats (где number == 1)
    downbeats = [b['time'] for b in beats if b.get('number') == 1] if beats else []
    downbeats_js = json.dumps(downbeats)
    
    # Извлекаем все времена beats
    all_beat_times = [b['time'] for b in beats] if beats else []
    all_beat_times_js = json.dumps(all_beat_times)
    
    html_content = f"""<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Madmom Analysis Visualization</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            margin: 0;
            padding: 20px;
            background: #1a1a1a;
            color: #e0e0e0;
        }}
        .container {{
            max-width: 1400px;
            margin: 0 auto;
        }}
        h1 {{
            color: #4CAF50;
            border-bottom: 2px solid #4CAF50;
            padding-bottom: 10px;
        }}
        .info {{
            background: #2a2a2a;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 20px;
        }}
        .info-item {{
            margin: 8px 0;
            font-size: 16px;
        }}
        .info-label {{
            color: #4CAF50;
            font-weight: bold;
            display: inline-block;
            width: 120px;
        }}
        .timeline-container {{
            background: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow-x: auto;
        }}
        .timeline {{
            position: relative;
            height: 200px;
            background: #1a1a1a;
            border: 1px solid #444;
            border-radius: 4px;
            margin-top: 10px;
        }}
        .beat {{
            position: absolute;
            width: 2px;
            height: 30px;
            background: #64B5F6;
            bottom: 0;
            cursor: pointer;
        }}
        .beat:hover {{
            background: #90CAF9;
            z-index: 10;
        }}
        .downbeat {{
            position: absolute;
            width: 3px;
            height: 50px;
            background: #4CAF50;
            bottom: 0;
            cursor: pointer;
        }}
        .downbeat:hover {{
            background: #66BB6A;
            z-index: 10;
        }}
        .grid-section {{
            position: absolute;
            height: 100px;
            border-left: 2px solid;
            border-right: 2px solid;
            top: 50px;
            opacity: 0.3;
        }}
        .grid-verse {{
            background: rgba(76, 175, 80, 0.1);
            border-color: #4CAF50;
        }}
        .grid-bridge {{
            background: rgba(255, 152, 0, 0.2);
            border-color: #FF9800;
        }}
        .legend {{
            display: flex;
            gap: 20px;
            margin-top: 10px;
            flex-wrap: wrap;
        }}
        .legend-item {{
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        .legend-color {{
            width: 20px;
            height: 20px;
            border-radius: 2px;
        }}
        .controls {{
            margin-bottom: 20px;
        }}
        .control-btn {{
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
            font-size: 14px;
        }}
        .control-btn:hover {{
            background: #45a049;
        }}
        .beat-info {{
            position: absolute;
            background: #333;
            padding: 5px 10px;
            border-radius: 4px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
            z-index: 100;
        }}
        .beat:hover .beat-info {{
            opacity: 1;
        }}
        .time-marker {{
            position: absolute;
            top: 0;
            width: 1px;
            height: 200px;
            background: #666;
            pointer-events: none;
        }}
        .time-label {{
            position: absolute;
            top: -20px;
            left: -20px;
            font-size: 10px;
            color: #999;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 Madmom Analysis Visualization</h1>
        
        <div class="info">
            <div class="info-item">
                <span class="info-label">Audio File:</span>
                <span>{Path(audio_path).name}</span>
            </div>
            <div class="info-item">
                <span class="info-label">BPM:</span>
                <span>{bpm}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Offset:</span>
                <span>{offset:.3f}s</span>
            </div>
            <div class="info-item">
                <span class="info-label">Duration:</span>
                <span>{duration:.2f}s</span>
            </div>
            <div class="info-item">
                <span class="info-label">Total Beats:</span>
                <span>{len(beats)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Downbeats:</span>
                <span>{len(downbeats)}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Grid Sections:</span>
                <span>{len(grid)}</span>
            </div>
        </div>
        
        <div class="controls">
            <button class="control-btn" onclick="zoomIn()">🔍 Zoom In</button>
            <button class="control-btn" onclick="zoomOut()">🔍 Zoom Out</button>
            <button class="control-btn" onclick="resetZoom()">↺ Reset</button>
            <button class="control-btn" onclick="toggleBeats()">Toggle Beats</button>
            <button class="control-btn" onclick="toggleDownbeats()">Toggle Downbeats</button>
            <button class="control-btn" onclick="toggleGrid()">Toggle Grid</button>
        </div>
        
        <div class="timeline-container">
            <h3>Timeline Visualization</h3>
            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color" style="background: #64B5F6;"></div>
                    <span>Beats</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: #4CAF50;"></div>
                    <span>Downbeats (1)</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: rgba(76, 175, 80, 0.3);"></div>
                    <span>Verse</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color" style="background: rgba(255, 152, 0, 0.3);"></div>
                    <span>Bridge</span>
                </div>
            </div>
            <div class="timeline" id="timeline"></div>
        </div>
    </div>
    
    <script>
        const beats = {beats_js};
        const downbeats = {downbeats_js};
        const allBeatTimes = {all_beat_times_js};
        const grid = {grid_js};
        const duration = {duration};
        const bpm = {bpm};
        const offset = {offset};
        
        let zoomLevel = 1;
        let showBeats = true;
        let showDownbeats = true;
        let showGrid = true;
        
        function renderTimeline() {{
            const timeline = document.getElementById('timeline');
            timeline.innerHTML = '';
            
            const width = timeline.offsetWidth;
            const scale = width / duration * zoomLevel;
            
            // Рендерим grid sections
            if (showGrid && grid.length > 0) {{
                grid.forEach(section => {{
                    const start = section.start * scale;
                    const beatsInSection = section.beats;
                    const beatDuration = 60.0 / bpm;
                    const sectionDuration = beatsInSection * beatDuration;
                    const sectionWidth = sectionDuration * scale;
                    
                    const div = document.createElement('div');
                    div.className = `grid-section grid-${{section.type}}`;
                    div.style.left = start + 'px';
                    div.style.width = sectionWidth + 'px';
                    div.title = `${{section.type}}: ${{section.start.toFixed(2)}}s - ${{(section.start + sectionDuration).toFixed(2)}}s (${{beatsInSection}} beats)`;
                    timeline.appendChild(div);
                }});
            }}
            
            // Рендерим time markers каждые 10 секунд
            for (let t = 0; t <= duration; t += 10) {{
                const marker = document.createElement('div');
                marker.className = 'time-marker';
                marker.style.left = (t * scale) + 'px';
                const label = document.createElement('div');
                label.className = 'time-label';
                label.textContent = t + 's';
                marker.appendChild(label);
                timeline.appendChild(marker);
            }}
            
            // Рендерим beats
            if (showBeats) {{
                beats.forEach(beat => {{
                    const div = document.createElement('div');
                    div.className = 'beat';
                    div.style.left = (beat.time * scale) + 'px';
                    div.title = `Beat #${{beat.number}} at ${{beat.time.toFixed(3)}}s`;
                    
                    const info = document.createElement('div');
                    info.className = 'beat-info';
                    info.textContent = `#${{beat.number}} ${{beat.time.toFixed(2)}}s`;
                    info.style.left = '-30px';
                    info.style.top = '-30px';
                    div.appendChild(info);
                    
                    timeline.appendChild(div);
                }});
            }}
            
            // Рендерим downbeats
            if (showDownbeats) {{
                downbeats.forEach(time => {{
                    const div = document.createElement('div');
                    div.className = 'downbeat';
                    div.style.left = (time * scale) + 'px';
                    div.title = `Downbeat at ${{time.toFixed(3)}}s`;
                    timeline.appendChild(div);
                }});
            }}
        }}
        
        function zoomIn() {{
            zoomLevel = Math.min(zoomLevel * 1.5, 10);
            renderTimeline();
        }}
        
        function zoomOut() {{
            zoomLevel = Math.max(zoomLevel / 1.5, 0.1);
            renderTimeline();
        }}
        
        function resetZoom() {{
            zoomLevel = 1;
            renderTimeline();
        }}
        
        function toggleBeats() {{
            showBeats = !showBeats;
            renderTimeline();
        }}
        
        function toggleDownbeats() {{
            showDownbeats = !showDownbeats;
            renderTimeline();
        }}
        
        function toggleGrid() {{
            showGrid = !showGrid;
            renderTimeline();
        }}
        
        // Initial render
        window.addEventListener('resize', renderTimeline);
        renderTimeline();
    </script>
</body>
</html>
"""
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"Visualization saved to: {output_path}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description='Visualize madmom analysis results')
    parser.add_argument('audio_path', help='Path to audio file')
    parser.add_argument('--analysis-json', help='Path to JSON file with analysis results (optional)')
    parser.add_argument('--output', '-o', help='Output HTML file path', default=None)
    
    args = parser.parse_args()
    
    # Если указан JSON файл, читаем из него
    if args.analysis_json:
        with open(args.analysis_json, 'r', encoding='utf-8') as f:
            analysis_result = json.load(f)
    else:
        # Иначе запускаем анализ через analyze-track.py
        print("Running analysis with analyze-track.py...", file=sys.stderr)
        import subprocess
        import os
        
        script_path = os.path.join(os.path.dirname(__file__), 'analyze-track.py')
        # Используем sys.executable для использования того же Python, что запустил скрипт
        python_executable = sys.executable
        # Убеждаемся, что переменные окружения передаются
        env = os.environ.copy()
        result = subprocess.run(
            [python_executable, script_path, args.audio_path],
            capture_output=True,
            text=True,
            env=env
        )
        
        if result.returncode != 0:
            print(f"Error running analysis: {result.stderr}", file=sys.stderr)
            sys.exit(1)
        
        analysis_result = json.loads(result.stdout)
        
        # Если нет beats, но есть grid, можем визуализировать grid
        if 'beats' not in analysis_result and 'grid' in analysis_result:
            print("Note: No beats array found, will visualize grid only", file=sys.stderr)
    
    # Определяем путь к выходному файлу
    if args.output:
        output_path = args.output
    else:
        audio_name = Path(args.audio_path).stem
        output_path = f"{audio_name}_madmom_visualization.html"
    
    create_visualization_html(args.audio_path, analysis_result, output_path)
    print(f"\n✅ Visualization created: {output_path}", file=sys.stderr)
    print(f"Open it in your browser to view the analysis results.", file=sys.stderr)


if __name__ == '__main__':
    main()

