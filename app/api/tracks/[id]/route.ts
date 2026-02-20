import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rm, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { requireAdmin } from '@/lib/auth'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { id } = await params
    const trackId = parseInt(id)

    if (isNaN(trackId)) {
      return NextResponse.json(
        { error: 'Invalid track ID' },
        { status: 400 }
      )
    }

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

    const publicDir = join(process.cwd(), 'public')

    // Удаляем оригинальный аудиофайл
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

    // Удаляем report-файлы (все с префиксом {basename}_*)
    if (track.pathOriginal) {
      const basename = track.pathOriginal
        .replace(/^.*[\\/]/, '')
        .replace(/\.[^.]+$/, '')
      const reportsDir = join(publicDir, 'uploads', 'reports')
      if (existsSync(reportsDir)) {
        try {
          const files = await readdir(reportsDir)
          const toDelete = files.filter((f) => f.startsWith(basename + '_'))
          for (const f of toDelete) {
            try {
              await rm(join(reportsDir, f))
              console.log(`Deleted report file: ${f}`)
            } catch (e: any) {
              console.warn(`Error deleting report file ${f}: ${e.message}`)
            }
          }
        } catch (e: any) {
          console.warn(`Error reading reports directory: ${e.message}`)
        }
      }
    }

    // Удаляем stems (если есть)
    if (track.isProcessed) {
      const stemsDir = join(publicDir, 'uploads', 'stems')
      const trackStemsDir = join(
        stemsDir,
        track.pathOriginal?.replace(/^uploads\/raw\//, '').replace(/\.[^/.]+$/, '') ||
          `track-${trackId}`
      )

      if (existsSync(trackStemsDir)) {
        try {
          await rm(trackStemsDir, { recursive: true, force: true })
          console.log(`Deleted stems directory: ${trackStemsDir}`)
        } catch (error: any) {
          console.warn(`Error deleting stems directory: ${error.message}`)
        }
      }

      const stemFiles = [
        track.pathVocals,
        track.pathDrums,
        track.pathBass,
        track.pathOther,
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
