import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, basename } from "path";
import type { GridMap, Beat } from "@/types";
import {
  generateFallbackBeatGrid,
  generateBeatGridFromDownbeats,
} from "./beatGrid";

const execAsync = promisify(exec);

// Загружаем переменные из .env.local (для надежности)
function loadEnvLocal() {
  const envPath = join(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          if (key && valueParts.length > 0) {
            const value = valueParts
              .join("=")
              .trim()
              .replace(/^["']|["']$/g, ""); // Убираем кавычки
            process.env[key.trim()] = value;
          }
        }
      }
    } catch (error) {
      console.warn("Failed to load .env.local:", error);
    }
  }
}

// Загружаем переменные при импорте модуля
loadEnvLocal();

export interface AudioAnalysisResult {
  bpm: number;
  offset: number;
  duration?: number;
  grid?: GridMap["grid"];
  downbeats?: number[];
}

export interface FullAudioAnalysisResult extends AudioAnalysisResult {
  duration: number;
  gridMap: GridMap | null;
  beatGrid: Beat[] | null;
}

export type AnalyzerType = "basic" | "extended" | "correlation";

/** Опции анализа: analyzer — скрипт (basic = analyze-track.py, extended = analyze-track-improved.py) */
export type AnalyzeTrackOptions =
  | { analyzer?: AnalyzerType; drumsPath?: string }
  | boolean;

/**
 * Анализирует аудио файл и определяет BPM, Offset и GridMap (с мостиками)
 * Использует Python скрипты: basic = analyze-track.py, extended = analyze-track-improved.py
 *
 * @param audioPath - путь к аудио файлу
 * @param options - true/undefined = basic; false = legacy analyze-bpm-offset; { analyzer: 'basic'|'extended', drumsPath? }
 */
export async function analyzeTrack(
  audioPath: string,
  options: AnalyzeTrackOptions = true,
  drumsPathLegacy?: string,
): Promise<FullAudioAnalysisResult> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const useLegacy = options === false;
  const useExtended =
    typeof options === "object" &&
    options !== null &&
    (options as { analyzer?: string }).analyzer === "extended";
  const useCorrelation =
    typeof options === "object" &&
    options !== null &&
    (options as { analyzer?: string }).analyzer === "correlation";
  const drumsPath =
    (typeof options === "object" && options !== null && "drumsPath" in options
      ? (options as { drumsPath?: string }).drumsPath
      : undefined) ?? drumsPathLegacy;
  const useGridScript = !useLegacy; // basic и extended возвращают grid

  // Перезагружаем переменные окружения на всякий случай
  loadEnvLocal();

  // Получаем путь к Python из venv (если указан)
  let pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
  if (pythonPath && pythonPath !== "python" && pythonPath !== "python3") {
    pythonPath = pythonPath.trim().replace(/^["']|["']$/g, "");
  }

  let scriptPath: string;
  if (useLegacy) {
    scriptPath = join(process.cwd(), "scripts", "analyze-bpm-offset.py");
  } else if (useCorrelation) {
    scriptPath = join(process.cwd(), "scripts", "analyze-track-correlation.py");
  } else if (useExtended) {
    scriptPath = join(process.cwd(), "scripts", "analyze-track-improved.py");
  } else {
    scriptPath = join(process.cwd(), "scripts", "analyze-track.py");
  }

  if (!existsSync(scriptPath)) {
    throw new Error(`Analysis script not found: ${scriptPath}`);
  }

  // Формируем команду с поддержкой drums
  let command: string;
  if (drumsPath && existsSync(drumsPath)) {
    // ПРИОРИТЕТ DRUMS: Используем дорожку drums для анализа ритма
    // Это уберет ложные срабатывания от вокала
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}" --use-drums "${drumsPath}"`;
    console.log(`Running audio analysis with DRUMS priority: ${command}`);
  } else {
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}"`;
    console.log(`Running audio analysis: ${command}`);
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000, // 5 минут таймаут
    });

    // stderr содержит логи, stdout - JSON результат
    if (stderr) {
      console.log("Analysis stderr:", stderr);
    }

    // Парсим JSON результат
    const result = JSON.parse(stdout.trim());

    if (result.error) {
      throw new Error(result.error);
    }

    // Для correlation v2: сохраняем полный JSON-отчёт в файл
    if (useCorrelation && result.row_analysis) {
      try {
        const reportsDir = join(process.cwd(), "public", "uploads", "reports");
        if (!existsSync(reportsDir)) {
          mkdirSync(reportsDir, { recursive: true });
        }
        const trackName = basename(audioPath, ".mp3").replace(/[^a-zA-Z0-9_-]/g, "_");
        const reportPath = join(reportsDir, `${trackName}_correlation_v2.json`);
        writeFileSync(reportPath, JSON.stringify(result, null, 2));
        console.log(`[Correlation] Full report saved: ${reportPath}`);
      } catch (e: any) {
        console.warn("[Correlation] Failed to save report:", e.message);
      }
    }

    // basic, extended и correlation возвращают gridMap
    if (useGridScript && result.grid) {
      const gridMap: GridMap = {
        bpm: result.bpm || 120,
        offset: result.offset || 0.0,
        grid: result.grid || [],
        downbeats: result.downbeats || [],
        totalBeats: result.totalBeats || 0,
      };

      // Для correlation: сохраняем row_analysis и verdict в gridMap
      if (useCorrelation && result.row_analysis) {
        (gridMap as any).correlationAnalysis = {
          verdict: result.verdict || null,
          row_analysis: result.row_analysis || null,
          top_madmom_beats: (result.top_madmom_beats || []).slice(0, 20),
          meta: result.meta || null,
        };
      }

      // Генерируем beatGrid на основе downbeats и секций
      const bpm = gridMap.bpm;
      const offset = gridMap.offset;
      const duration = result.duration || 180; // Default 3 minutes if not provided

      // Используем новую функцию для генерации beatGrid на основе downbeats и секций
      const beatGrid = generateBeatGridFromDownbeats(gridMap, duration);

      return {
        bpm: gridMap.bpm,
        offset: gridMap.offset,
        duration: duration, // ОБЯЗАТЕЛЬНО возвращаем duration
        gridMap: gridMap,
        beatGrid: beatGrid,
        grid: result.grid || [],
        downbeats: result.downbeats || [],
      };
    }

    // Fallback для старого скрипта
    const bpm = result.bpm || 120;
    const offset = result.offset || 0.0;
    const duration = result.duration || 180; // Default 3 minutes if not provided
    const beatGrid = generateFallbackBeatGrid(bpm, offset, duration);

    return {
      bpm: bpm,
      offset: offset,
      duration: duration, // ОБЯЗАТЕЛЬНО возвращаем duration
      gridMap: null,
      beatGrid: beatGrid,
    };
  } catch (error: any) {
    console.error("Audio analysis error:", error);

    if (error.code === "ENOENT") {
      throw new Error(
        "Python or required libraries not found. Please install: pip install -r requirements.txt",
      );
    }
    if (error.code === "ETIMEDOUT" || error.signal === "SIGTERM") {
      throw new Error("Audio analysis timed out. The file might be too large.");
    }

    // Если ошибка парсинга JSON, возможно скрипт вернул ошибку
    if (error.message.includes("JSON")) {
      throw new Error(`Failed to parse analysis result: ${error.message}`);
    }

    throw new Error(`Audio analysis failed: ${error.message}`);
  }
}

/**
 * Анализирует аудио файл и определяет только BPM и Offset (для обратной совместимости)
 * Использует Python скрипт analyze-bpm-offset.py
 *
 * @param audioPath - путь к аудио файлу
 * @param drumsPath - опциональный путь к дорожке drums (для более точного анализа)
 * @deprecated Используйте analyzeTrack для получения полного анализа с gridMap
 */
export async function analyzeBpmOffset(
  audioPath: string,
  drumsPath?: string,
): Promise<AudioAnalysisResult> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  // Перезагружаем переменные окружения на всякий случай
  loadEnvLocal();

  // Получаем путь к Python из venv (если указан)
  let pythonPath = process.env.DEMUCS_PYTHON_PATH || "python";
  // Нормализуем путь (убираем кавычки, если есть)
  if (pythonPath && pythonPath !== "python" && pythonPath !== "python3") {
    pythonPath = pythonPath.trim().replace(/^["']|["']$/g, "");
  }

  // Путь к старому скрипту анализа
  const scriptPath = join(process.cwd(), "scripts", "analyze-bpm-offset.py");

  if (!existsSync(scriptPath)) {
    throw new Error(`Analysis script not found: ${scriptPath}`);
  }

  // Формируем команду
  let command: string;
  if (drumsPath && existsSync(drumsPath)) {
    // Используем дорожку drums для более точного анализа
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}" --use-drums "${drumsPath}"`;
  } else {
    // Анализируем оригинальный файл
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}"`;
  }

  console.log(`Running audio analysis: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000, // 5 минут таймаут
    });

    // stderr содержит логи, stdout - JSON результат
    if (stderr) {
      console.log("\n" + "=".repeat(80));
      console.log("🔍 PYTHON SCRIPT STDERR (BPM/Offset Analysis Logs):");
      console.log("=".repeat(80));
      console.log(stderr);
      console.log("=".repeat(80) + "\n");
    } else {
      console.warn(
        "⚠️ WARNING: No stderr output from Python script - this is unusual!",
      );
    }

    // Парсим JSON результат
    const result = JSON.parse(stdout.trim());

    if (result.error) {
      throw new Error(result.error);
    }

    return {
      bpm: result.bpm || 120,
      offset: result.offset || 0.0,
    };
  } catch (error: any) {
    console.error("Audio analysis error:", error);

    if (error.code === "ENOENT") {
      throw new Error(
        "Python not found or analysis script failed. Please check Python installation and dependencies.",
      );
    }
    if (error.code === "ETIMEDOUT" || error.signal === "SIGTERM") {
      throw new Error("Audio analysis timed out. The file might be too large.");
    }

    // Если ошибка парсинга JSON, возможно скрипт вернул ошибку
    if (error.message.includes("JSON")) {
      throw new Error(`Failed to parse analysis result: ${error.message}`);
    }

    throw new Error(`Audio analysis failed: ${error.message}`);
  }
}
