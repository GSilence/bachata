import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { runDemucs } from '@/lib/demucs'
import { analyzeBpmOffset } from '@/lib/analyzeAudio'

// Настройки для работы с большими файлами и долгими операциями
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600 // 10 минут таймаут для API route (Next.js 15)

// Максимальный размер файла: 100MB
const MAX_FILE_SIZE = 100 * 1024 * 1024

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const title = formData.get('title') as string | null
    const artist = formData.get('artist') as string | null
    const bpm = formData.get('bpm') as string | null
    const offset = formData.get('offset') as string | null
    const autoBpm = formData.get('autoBpm') === 'true'
    const autoOffset = formData.get('autoOffset') === 'true'

    // Валидация
    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!title) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    // Проверка типа файла
    if (!file.type.includes('audio') && !file.name.toLowerCase().endsWith('.mp3')) {
      return NextResponse.json(
        { error: 'Only MP3 audio files are supported' },
        { status: 400 }
      )
    }

    // Проверка размера
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Создаем директории, если их нет
    const uploadsDir = join(process.cwd(), 'public', 'uploads', 'raw')
    const stemsDir = join(process.cwd(), 'public', 'uploads', 'stems')

    if (!existsSync(uploadsDir)) {
      await mkdir(uploadsDir, { recursive: true })
    }
    if (!existsSync(stemsDir)) {
      await mkdir(stemsDir, { recursive: true })
    }

    // Генерируем уникальное имя файла
    const timestamp = Date.now()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const fileName = `${timestamp}_${safeFileName}`
    const filePath = join(uploadsDir, fileName)
    
    console.log(`Processing track: ${title} by ${artist || 'Unknown'}`)
    console.log(`File: ${fileName} (${(file.size / 1024 / 1024).toFixed(2)} MB)`)

    // Сохраняем файл
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(filePath, buffer)

    console.log(`File saved: ${filePath}`)

    // Запускаем Demucs
    const trackName = title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()
    const stemsResult = await runDemucs(filePath, stemsDir, trackName)

    // Определяем BPM и Offset
    let finalBpm = bpm ? parseInt(bpm) : 120
    let finalOffset = offset ? parseFloat(offset) : 0
    let baseBpm: number | null = null
    let baseOffset: number | null = null

    // Если нужно автоматическое определение, анализируем аудио
    if (autoBpm || autoOffset) {
      try {
        console.log('Starting audio analysis for BPM and Offset...')
        
        // Используем дорожку drums для более точного анализа (если доступна)
        const drumsPath = stemsResult.drums 
          ? join(process.cwd(), 'public', stemsResult.drums)
          : undefined

        const analysisResult = await analyzeBpmOffset(
          filePath,
          drumsPath
        )

        // Обновляем только те значения, которые нужно определить автоматически
        if (autoBpm) {
          finalBpm = analysisResult.bpm
          baseBpm = analysisResult.bpm // Сохраняем как базовое
          console.log(`Auto-detected BPM: ${finalBpm}`)
        } else {
          // Если BPM введен вручную, сохраняем его как базовое
          baseBpm = finalBpm
        }
        
        if (autoOffset) {
          finalOffset = analysisResult.offset
          baseOffset = analysisResult.offset // Сохраняем как базовое
          console.log(`Auto-detected Offset: ${finalOffset}s`)
        } else {
          // Если Offset введен вручную, сохраняем его как базовое
          baseOffset = finalOffset
        }
      } catch (error: any) {
        console.warn('Audio analysis failed, using provided/default values:', error.message)
        // Если анализ не удался, используем введенные значения как базовые
        baseBpm = finalBpm
        baseOffset = finalOffset
      }
    } else {
      // Если все введено вручную, сохраняем как базовые значения
      baseBpm = finalBpm
      baseOffset = finalOffset
    }

    // Импортируем Prisma динамически
    const { prisma } = await import('@/lib/prisma')

    if (!prisma) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: 500 }
      )
    }

    // Создаем запись в БД
    const track = await prisma.track.create({
      data: {
        title: title,
        artist: artist || null,
        filename: fileName, // Для совместимости со старой схемой
        bpm: finalBpm,
        offset: finalOffset,
        baseBpm: baseBpm,
        baseOffset: baseOffset,
        isFree: true,
        pathOriginal: `/uploads/raw/${fileName}`,
        pathVocals: stemsResult.vocals,
        pathDrums: stemsResult.drums,
        pathBass: stemsResult.bass,
        pathOther: stemsResult.other,
        isProcessed: true,
      },
    })

    return NextResponse.json({
      success: true,
      track: track,
      message: 'Track processed successfully',
    })
  } catch (error: any) {
    console.error('Error processing track:', error)
    return NextResponse.json(
      {
        error: error.message || 'Failed to process track',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}

