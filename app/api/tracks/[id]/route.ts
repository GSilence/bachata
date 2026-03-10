import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rm, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { requireAdmin, getCurrentUser } from '@/lib/auth'
import { keyFromUrl, deleteFile as deleteS3File, isS3Enabled } from '@/lib/storage'

/** GET /api/tracks/[id] — полный трек с gridMap (для воспроизведения). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const trackId = parseInt(id, 10)
  if (isNaN(trackId)) {
    return NextResponse.json({ error: 'Invalid track ID' }, { status: 400 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  const track = await prisma.track.findUnique({ where: { id: trackId } })
  if (!track) {
    return NextResponse.json({ error: 'Track not found' }, { status: 404 })
  }

  // Guest users can only access public approved tracks
  const user = await getCurrentUser()
  if (!user) {
    if (track.visibility !== 'public' || track.trackStatus !== 'approved') {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 })
    }
  }

  return NextResponse.json({
    ...track,
    fileSize: track.fileSize != null ? Number(track.fileSize) : null,
  })
}

/** PATCH /api/tracks/[id] — обновление названия и метаданных трека (только для админа). */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let authUser: { userId: number; email: string; role: string };
  try {
    authUser = await requireAdmin(request)
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
    'hasAccents', 'hasMambo', 'trackStatus', 'isPrimary',
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
      data['metaComment'] = body[key] === null ? null : (body[key] as string).trim().slice(0, 1000) || null
    } else if (key === 'metaTrackNum' && (body[key] === null || (typeof body[key] === 'number' && Number.isInteger(body[key])))) {
      data['metaTrackNum'] = body[key] as number | null
    } else if (key === 'hasAccents' && typeof body[key] === 'boolean') {
      data['hasAccents'] = body[key]
    } else if (key === 'hasMambo' && typeof body[key] === 'boolean') {
      data['hasMambo'] = body[key]
    } else if (key === 'trackStatus' && typeof body[key] === 'string' && ['unlistened', 'moderation', 'approved'].includes(body[key] as string)) {
      data['trackStatus'] = body[key] as string
    } else if (key === 'isPrimary' && typeof body[key] === 'boolean') {
      data['isPrimary'] = body[key]
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No allowed fields to update' }, { status: 400 })
  }

  // Читаем текущий статус для лога (только если статус меняется)
  const newStatus = data['trackStatus'] as string | undefined;
  let oldStatus: string | undefined;
  if (newStatus) {
    const current = await prisma.track.findUnique({ where: { id: trackId }, select: { trackStatus: true } });
    oldStatus = current?.trackStatus ?? undefined;
  }

  type UpdateData = Parameters<typeof prisma.track.update>[0]['data']
  const updated = await prisma.track.update({
    where: { id: trackId },
    data: data as UpdateData,
  })

  // Лог смены статуса
  if (newStatus && newStatus !== oldStatus) {
    try {
      await prisma.trackLog.create({
        data: {
          trackId,
          userId: authUser.userId,
          event: 'status_change',
          details: { email: authUser.email, oldStatus, newStatus },
        },
      });
    } catch {}
    if (newStatus !== 'unlistened') {
      // Трек вышел из "unlistened" — закрываем ModQueue
      try {
        await prisma.modQueue.updateMany({
          where: { trackId, status: { not: 'done' } },
          data: { status: 'done' },
        });
      } catch {}
    } else if (oldStatus && oldStatus !== 'unlistened') {
      // Трек возвращён в "unlistened" — сбрасываем или создаём запись ModQueue
      try {
        await prisma.modQueue.upsert({
          where: { trackId },
          create: { trackId, status: 'pending', swapCount: 0 },
          update: { status: 'pending', assignedTo: null, assignedAt: null, swapCount: 0 },
        });
      } catch {}
    }
  }

  return NextResponse.json({
    track: {
      ...updated,
      fileSize: updated.fileSize != null ? Number(updated.fileSize) : null,
    },
  })
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

    // Хелпер: удаляет файл из S3 или локально (по URL или локальному пути)
    const deleteAudioFile = async (urlOrPath: string) => {
      const key = keyFromUrl(urlOrPath)
      if (key && isS3Enabled()) {
        try { await deleteS3File(key); console.log(`Deleted from S3: ${key}`) } catch (e: any) { console.warn(`S3 delete error: ${e.message}`) }
      } else {
        const localPath = urlOrPath.startsWith('/') ? join(publicDir, urlOrPath) : join(publicDir, urlOrPath)
        if (existsSync(localPath)) {
          try { await rm(localPath); console.log(`Deleted local: ${urlOrPath}`) } catch (e: any) { console.warn(`Local delete error: ${e.message}`) }
        }
      }
    }

    // Удаляем оригинальный аудиофайл
    if (track.pathOriginal) {
      await deleteAudioFile(track.pathOriginal)
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
        await deleteAudioFile(stemPath)
      }
    }

    // Лог удаления (trackId=null, т.к. трек сейчас будет удалён — SetNull сохранит запись)
    try {
      await prisma.trackLog.create({
        data: {
          trackId: null,
          event: 'track_deleted',
          details: { title: track.title, artist: track.artist ?? null, deletedTrackId: trackId },
        },
      });
    } catch {}

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
