import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const trackId = parseInt(params.id)
    
    if (isNaN(trackId)) {
      return NextResponse.json(
        { error: 'Invalid track ID' },
        { status: 400 }
      )
    }

    // Проверяем наличие Prisma Client
    if (!prisma) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    // Получаем трек из БД
    const track = await prisma.track.findUnique({
      where: { id: trackId }
    })

    if (!track) {
      return NextResponse.json(
        { error: 'Track not found' },
        { status: 404 }
      )
    }

    // Удаляем физические файлы
    const publicDir = join(process.cwd(), 'public')
    
    // Удаляем основной файл (filename)
    if (track.filename) {
      const mainFilePath = join(publicDir, track.filename)
      if (existsSync(mainFilePath)) {
        try {
          await rm(mainFilePath)
          console.log(`Deleted main file: ${track.filename}`)
        } catch (error: any) {
          console.warn(`Error deleting main file: ${error.message}`)
        }
      }
    }

    // Удаляем оригинальный файл (pathOriginal)
    if (track.pathOriginal) {
      const originalPath = join(publicDir, track.pathOriginal)
      if (existsSync(originalPath)) {
        try {
          await rm(originalPath)
          console.log(`Deleted original file: ${track.pathOriginal}`)
        } catch (error: any) {
          console.warn(`Error deleting original file: ${error.message}`)
        }
      }
    }

    // Удаляем stems (если есть)
    if (track.isProcessed) {
      const stemsDir = join(publicDir, 'uploads', 'stems')
      const trackStemsDir = join(stemsDir, track.pathOriginal?.replace(/^uploads\/raw\//, '').replace(/\.[^/.]+$/, '') || `track-${trackId}`)
      
      if (existsSync(trackStemsDir)) {
        try {
          await rm(trackStemsDir, { recursive: true, force: true })
          console.log(`Deleted stems directory: ${trackStemsDir}`)
        } catch (error: any) {
          console.warn(`Error deleting stems directory: ${error.message}`)
        }
      }

      // Также удаляем отдельные файлы stems если они указаны
      const stemFiles = [
        track.pathVocals,
        track.pathDrums,
        track.pathBass,
        track.pathOther
      ].filter(Boolean) as string[]

      for (const stemPath of stemFiles) {
        const fullStemPath = join(publicDir, stemPath)
        if (existsSync(fullStemPath)) {
          try {
            await rm(fullStemPath)
            console.log(`Deleted stem file: ${stemPath}`)
          } catch (error: any) {
            console.warn(`Error deleting stem file ${stemPath}: ${error.message}`)
          }
        }
      }
    }

    // Удаляем запись из БД
    await prisma.track.delete({
      where: { id: trackId }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting track:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
