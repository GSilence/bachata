import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rm, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { requireAdmin } from '@/lib/auth'

/** PATCH /api/tracks/[id] — обновление названия и метаданных трека (только для админа). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const trackId = parseInt(id, 10)
  if (isNaN(trackId)) {
    return NextResponse.json({ error: 'Invalid track ID' }, { status: 400 })
  }
  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const allowed: (keyof typeof body)[] = [
    'title', 'artist',
    'metaTitle', 'metaArtist', 'metaAlbum', 'metaYear', 'metaGenre', 'metaComment', 'metaTrackNum',
    'hasAccents', 'hasMambo', 'trackStatus',
  ]
  const data: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] === undefined) continue
    if (key === 'title' && typeof body[key] === 'string') {
      data['title'] = body[key].trim() || (body[key] as string)
    } else if (key === 'artist' && (body[key] === null || typeof body[key] === 'string')) {
      data['artist'] = body[key] === null ? null : (body[key] as string).trim() || null
    } else if (key === 'metaTitle' && (body[key] === null || typeof body[key] === 'string')) {
      data['metaTitle'] = body[key] === null ? null : (body[key] as string).trim().slice(0, 500) || null
    } else if (key === 'metaArtist' && (body[key] === null || typeof body[key] === 'string')) {
      data['metaArtist'] = body[key] === null ? null : (body[key] as string).trim().slice(0, 500) || null
    } else if (key === 'metaAlbum' && (body[key] === null || typeof body[key] === 'string')) {
      data['metaAlbum'] = body[key] === null ? null : (body[key] as string).trim().slice(0, 500) || null
    } else if (key === 'metaYear' && (body[key] === null || (typeof body[key] === 'number' && Number.isInteger(body[key])))) {
      data['metaYear'] = body[key] as number | null
    } else if (key === 'metaGenre' && (body[key] === null || typeof body[key] === 'string')) {
      data['metaGenre'] = body[key] === null ? null : (body[key] as string).trim().slice(0, 200) || null
    } else if (key === 'metaComment' && (body[key] === null || typeof body[key] === 'string')) {
      data['metaComment'] = body[key] === null ? null : (body[key] as string).trim() || null
    } else if (key === 'metaTrackNum' && (body[key] === null || (typeof body[key] === 'number' && Number.isInteger(body[key])))) {
      data['metaTrackNum'] = body[key] as number | null
    } else if (key === 'hasAccents' && typeof body[key] === 'boolean') {
      data['hasAccents'] = body[key]
    } else if (key === 'hasMambo' && typeof body[key] === 'boolean') {
      data['hasMambo'] = body[key]
    } else if (key === 'trackStatus' && typeof body[key] === 'string' && ['unlistened', 'moderation', 'approved'].includes(body[key] as string)) {
      data['trackStatus'] = body[key] as string
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 })
  }
  type UpdateData = Parameters<typeof prisma.track.update>[0]['data']
  const updated = await prisma.track.update({
    where: { id: trackId },
    data: data as UpdateData,
  })
  return NextResponse.json({ track: updated })
}

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
