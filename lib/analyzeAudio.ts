import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { GridMap, Beat } from '@/types'
import { generateFallbackBeatGrid, generateBeatGridFromDownbeats } from './beatGrid'

const execAsync = promisify(exec)

// Загружаем переменные из .env.local (для надежности)
function loadEnvLocal() {
  const envPath = join(process.cwd(), '.env.local')
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, ...valueParts] = trimmed.split('=')
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '') // Убираем кавычки
            process.env[key.trim()] = value
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load .env.local:', error)
    }
  }
}

// Загружаем переменные при импорте модуля
loadEnvLocal()

export interface AudioAnalysisResult {
  bpm: number
  offset: number
  duration?: number
  grid?: GridMap['grid']
  downbeats?: number[]
}

export interface FullAudioAnalysisResult extends AudioAnalysisResult {
  duration: number
  gridMap: GridMap | null
  beatGrid: Beat[] | null
}

/**
 * Анализирует аудио файл и определяет BPM, Offset и GridMap (с мостиками)
 * Использует новый Python скрипт с madmom
 * 
 * @param audioPath - путь к аудио файлу
 * @param useNewScript - использовать ли новый скрипт analyze-track.py (по умолчанию true)
 * @param drumsPath - опциональный путь к дорожке drums (для более точного анализа ритма)
 */
export async function analyzeTrack(
  audioPath: string,
  useNewScript: boolean = true,
  drumsPath?: string
): Promise<FullAudioAnalysisResult> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`)
  }

  // Перезагружаем переменные окружения на всякий случай
  loadEnvLocal()
  
  // Получаем путь к Python из venv (если указан)
  let pythonPath = process.env.DEMUCS_PYTHON_PATH || 'python'
  // Нормализуем путь (убираем кавычки, если есть)
  if (pythonPath && pythonPath !== 'python' && pythonPath !== 'python3') {
    pythonPath = pythonPath.trim().replace(/^["']|["']$/g, '')
  }
  
  // Используем новый скрипт по умолчанию
  const scriptPath = useNewScript
    ? join(process.cwd(), 'scripts', 'analyze-track.py')
    : join(process.cwd(), 'scripts', 'analyze-bpm-offset.py')
  
  if (!existsSync(scriptPath)) {
    throw new Error(`Analysis script not found: ${scriptPath}`)
  }

  // Формируем команду с поддержкой drums
  let command: string
  if (drumsPath && existsSync(drumsPath)) {
    // ПРИОРИТЕТ DRUMS: Используем дорожку drums для анализа ритма
    // Это уберет ложные срабатывания от вокала
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}" --use-drums "${drumsPath}"`
    console.log(`Running audio analysis with DRUMS priority: ${command}`)
  } else {
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}"`
    console.log(`Running audio analysis: ${command}`)
  }

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000, // 5 минут таймаут
    })

    // stderr содержит логи, stdout - JSON результат
    if (stderr) {
      console.log('Analysis stderr:', stderr)
    }

    // Парсим JSON результат
    const result = JSON.parse(stdout.trim())
    
    if (result.error) {
      throw new Error(result.error)
    }

    // Если используется новый скрипт, возвращаем gridMap
    if (useNewScript && result.grid) {
      const gridMap: GridMap = {
        bpm: result.bpm || 120,
        offset: result.offset || 0.0,
        grid: result.grid || [],
        downbeats: result.downbeats || [],
        totalBeats: result.totalBeats || 0
      }
      
      // Генерируем beatGrid на основе downbeats и секций
      const bpm = gridMap.bpm
      const offset = gridMap.offset
      const duration = result.duration || 180 // Default 3 minutes if not provided
      
      // Используем новую функцию для генерации beatGrid на основе downbeats и секций
      const beatGrid = generateBeatGridFromDownbeats(gridMap, duration)
      
      return {
        bpm: gridMap.bpm,
        offset: gridMap.offset,
        duration: duration, // ОБЯЗАТЕЛЬНО возвращаем duration
        gridMap: gridMap,
        beatGrid: beatGrid,
        grid: result.grid || [],
        downbeats: result.downbeats || []
      }
    }

    // Fallback для старого скрипта
    const bpm = result.bpm || 120
    const offset = result.offset || 0.0
    const duration = result.duration || 180 // Default 3 minutes if not provided
    const beatGrid = generateFallbackBeatGrid(bpm, offset, duration)
    
    return {
      bpm: bpm,
      offset: offset,
      duration: duration, // ОБЯЗАТЕЛЬНО возвращаем duration
      gridMap: null,
      beatGrid: beatGrid
    }
  } catch (error: any) {
    console.error('Audio analysis error:', error)
    
    if (error.code === 'ENOENT') {
      throw new Error('Python or required libraries not found. Please install: pip install -r requirements.txt')
    }
    if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
      throw new Error('Audio analysis timed out. The file might be too large.')
    }
    
    // Если ошибка парсинга JSON, возможно скрипт вернул ошибку
    if (error.message.includes('JSON')) {
      throw new Error(`Failed to parse analysis result: ${error.message}`)
    }
    
    throw new Error(`Audio analysis failed: ${error.message}`)
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
  drumsPath?: string
): Promise<AudioAnalysisResult> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`)
  }

  // Перезагружаем переменные окружения на всякий случай
  loadEnvLocal()
  
  // Получаем путь к Python из venv (если указан)
  let pythonPath = process.env.DEMUCS_PYTHON_PATH || 'python'
  // Нормализуем путь (убираем кавычки, если есть)
  if (pythonPath && pythonPath !== 'python' && pythonPath !== 'python3') {
    pythonPath = pythonPath.trim().replace(/^["']|["']$/g, '')
  }
  
  // Путь к старому скрипту анализа
  const scriptPath = join(process.cwd(), 'scripts', 'analyze-bpm-offset.py')
  
  if (!existsSync(scriptPath)) {
    throw new Error(`Analysis script not found: ${scriptPath}`)
  }

  // Формируем команду
  let command: string
  if (drumsPath && existsSync(drumsPath)) {
    // Используем дорожку drums для более точного анализа
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}" --use-drums "${drumsPath}"`
  } else {
    // Анализируем оригинальный файл
    command = `"${pythonPath}" "${scriptPath}" "${audioPath}"`
  }

  console.log(`Running audio analysis: ${command}`)

  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000, // 5 минут таймаут
    })

    // stderr содержит логи, stdout - JSON результат
    if (stderr) {
      console.log('\n' + '='.repeat(80))
      console.log('🔍 PYTHON SCRIPT STDERR (BPM/Offset Analysis Logs):')
      console.log('='.repeat(80))
      console.log(stderr)
      console.log('='.repeat(80) + '\n')
    } else {
      console.warn('⚠️ WARNING: No stderr output from Python script - this is unusual!')
    }

    // Парсим JSON результат
    const result = JSON.parse(stdout.trim())
    
    if (result.error) {
      throw new Error(result.error)
    }

    return {
      bpm: result.bpm || 120,
      offset: result.offset || 0.0,
    }
  } catch (error: any) {
    console.error('Audio analysis error:', error)
    
    if (error.code === 'ENOENT') {
      throw new Error('Python not found or analysis script failed. Please check Python installation and dependencies.')
    }
    if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
      throw new Error('Audio analysis timed out. The file might be too large.')
    }
    
    // Если ошибка парсинга JSON, возможно скрипт вернул ошибку
    if (error.message.includes('JSON')) {
      throw new Error(`Failed to parse analysis result: ${error.message}`)
    }
    
    throw new Error(`Audio analysis failed: ${error.message}`)
  }
}

