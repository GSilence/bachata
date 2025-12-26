import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

export interface AudioAnalysisResult {
  bpm: number
  offset: number
}

/**
 * Анализирует аудио файл и определяет BPM и Offset
 * Использует Python скрипт с librosa
 * 
 * @param audioPath - путь к аудио файлу
 * @param drumsPath - опциональный путь к дорожке drums (для более точного анализа)
 */
export async function analyzeBpmOffset(
  audioPath: string,
  drumsPath?: string
): Promise<AudioAnalysisResult> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`)
  }

  // Получаем путь к Python из venv (если указан)
  const pythonPath = process.env.DEMUCS_PYTHON_PATH || 'python'
  
  // Путь к скрипту анализа
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
      console.log('Analysis stderr:', stderr)
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
      throw new Error('Python or librosa not found. Please install: pip install librosa soundfile')
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

