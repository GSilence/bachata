import { exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

export interface DemucsResult {
  vocals: string | null
  drums: string | null
  bass: string | null
  other: string | null
}

/**
 * Проверяет, установлен ли Demucs
 * Пробует разные варианты: прямой вызов, через python -m, через venv
 */
export async function checkDemucsInstalled(): Promise<boolean> {
  // Если указан путь к Python из venv, пробуем его первым
  const pythonPath = process.env.DEMUCS_PYTHON_PATH
  if (pythonPath && existsSync(pythonPath)) {
    try {
      await execAsync(`"${pythonPath}" -m demucs.separate --help`)
      return true
    } catch (error) {
      // Продолжаем проверку другими способами
    }
  }

  const commands = [
    'demucs --help',
    'python -m demucs.separate --help',
    'python3 -m demucs.separate --help',
  ]

  for (const cmd of commands) {
    try {
      await execAsync(cmd)
      return true
    } catch (error) {
      // Пробуем следующую команду
      continue
    }
  }

  return false
}

/**
 * Получает команду для запуска Demucs
 * Пробует найти рабочую команду
 */
async function getDemucsCommand(): Promise<string> {
  // Если указан путь к Python из venv, используем его в первую очередь
  const pythonPath = process.env.DEMUCS_PYTHON_PATH
  if (pythonPath && existsSync(pythonPath)) {
    // Пробуем проверить, работает ли команда
    try {
      await execAsync(`"${pythonPath}" -m demucs.separate --help`)
      return `"${pythonPath}" -m demucs.separate`
    } catch (error) {
      // Если проверка не прошла, все равно используем этот путь,
      // так как он указан явно и файл существует
      console.warn('Проверка DEMUCS_PYTHON_PATH не прошла, но используем указанный путь')
      return `"${pythonPath}" -m demucs.separate`
    }
  }

  // Если DEMUCS_PYTHON_PATH не указан, пробуем другие варианты
  const commands = [
    'python -m demucs.separate',
    'python3 -m demucs.separate',
    'demucs',
  ]

  for (const cmd of commands) {
    try {
      await execAsync(`${cmd} --help`)
      return cmd
    } catch (error) {
      continue
    }
  }

  // Если ничего не работает и DEMUCS_PYTHON_PATH не указан, выбрасываем ошибку
  throw new Error(
    'Demucs не найден. Установите его: pip install demucs\n' +
    'Или укажите DEMUCS_PYTHON_PATH в .env.local (например: DEMUCS_PYTHON_PATH=D:\\Sites\\bachata\\venv\\Scripts\\python.exe)'
  )
}

/**
 * Запускает Demucs для разделения аудио на стемы
 * @param inputPath - путь к входному файлу
 * @param outputDir - директория для сохранения результатов
 * @param trackName - имя трека (используется для создания подпапки)
 */
export async function runDemucs(
  inputPath: string,
  outputDir: string,
  trackName: string
): Promise<DemucsResult> {
  // Проверяем наличие входного файла
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  // Получаем рабочую команду для Demucs
  const demucsCmd = await getDemucsCommand()
  
  // Команда Demucs
  // --shifts 5: прогоняем файл 5 раз для лучшего качества (equivariant stabilization)
  // --mp3: сохраняем результат в MP3 формате
  // Demucs создает папку с именем модели (например, htdemucs) внутри outputDir
  // Используем модель htdemucs по умолчанию (лучшее качество)
  // Разделяем на 4 стема: vocals, drums, bass, other
  const command = `${demucsCmd} "${inputPath}" -o "${outputDir}" --shifts 5 --mp3`

  console.log(`Running Demucs: ${command}`)

  try {
    // Запускаем Demucs (это может занять несколько минут)
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer для вывода
      timeout: 600000, // 10 минут таймаут
    })

    console.log('Demucs stdout:', stdout)
    if (stderr) {
      console.warn('Demucs stderr:', stderr)
    }

    // Demucs создает папку с именем модели (например, htdemucs) внутри outputDir
    // Затем внутри этой папки создается папка с именем файла (без расширения)
    const inputFileName = inputPath.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') || trackName
    
    // Ищем папку модели (обычно htdemucs, но может быть и другая)
    const modelDirs = ['htdemucs', 'htdemucs_ft', 'mdx_extra', 'mdx_extra_q']
    let stemsDir: string | null = null
    
    for (const modelDir of modelDirs) {
      const potentialDir = join(outputDir, modelDir, inputFileName)
      if (existsSync(potentialDir)) {
        stemsDir = potentialDir
        break
      }
    }
    
    // Если не нашли по стандартным именам, ищем любую папку в outputDir
    if (!stemsDir) {
      const outputFiles = readdirSync(outputDir)
      for (const file of outputFiles) {
        const potentialDir = join(outputDir, file, inputFileName)
        if (existsSync(potentialDir)) {
          stemsDir = potentialDir
          break
        }
      }
    }

    // Проверяем, что папка создана
    if (!stemsDir || !existsSync(stemsDir)) {
      throw new Error(`Demucs output directory not found. Expected in: ${join(outputDir, 'htdemucs', inputFileName)}`)
    }

    // Ищем файлы стемов
    const result: DemucsResult = {
      vocals: null,
      drums: null,
      bass: null,
      other: null,
    }

    const files = readdirSync(stemsDir)
    
    for (const file of files) {
      const filePath = join(stemsDir, file)
      const stat = statSync(filePath)
      
      if (stat.isFile()) {
            const fileName = file.toLowerCase()
        // Получаем относительный путь от public (например, /uploads/stems/htdemucs/track_name/vocals.mp3)
        const relativePath = stemsDir.replace(process.cwd(), '').replace(/\\/g, '/')
        // Убираем /public из пути, так как Next.js обслуживает файлы из public напрямую
        const publicRelativePath = relativePath.replace(/^\/public/, '')
        const fullRelativePath = `${publicRelativePath}/${file}`
        
        // Теперь файлы в формате MP3, но проверяем и .wav на случай, если что-то пошло не так
        if (fileName.includes('vocals') && (fileName.endsWith('.mp3') || fileName.endsWith('.wav'))) {
          result.vocals = fullRelativePath
        } else if (fileName.includes('drums') && (fileName.endsWith('.mp3') || fileName.endsWith('.wav'))) {
          result.drums = fullRelativePath
        } else if (fileName.includes('bass') && (fileName.endsWith('.mp3') || fileName.endsWith('.wav'))) {
          result.bass = fullRelativePath
        } else if ((fileName.includes('other') || fileName.includes('no_vocals')) && (fileName.endsWith('.mp3') || fileName.endsWith('.wav'))) {
          result.other = fullRelativePath
        }
      }
    }

    // Проверяем, что хотя бы один файл найден
    if (!result.vocals && !result.drums && !result.bass && !result.other) {
      throw new Error(`No stem files found in ${stemsDir}. Expected MP3 files (vocals.mp3, drums.mp3, bass.mp3, other.mp3)`)
    }

    return result
  } catch (error: any) {
    console.error('Demucs error:', error)
    
    // Более понятные сообщения об ошибках
    if (error.code === 'ENOENT') {
      throw new Error('Demucs not found. Please install it: pip install demucs')
    }
    if (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM') {
      throw new Error('Demucs process timed out. The file might be too large.')
    }
    
    throw new Error(`Demucs failed: ${error.message}`)
  }
}

