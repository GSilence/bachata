import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { isS3Enabled, keyFromUrl } from '@/lib/storage'
import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'

const BATCH_SIZE = 50

/**
 * GET /api/admin/backfill-metadata — статистика: сколько треков без fileSize/duration
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  const total = await prisma.track.count()
  const missingFileSize = await prisma.track.count({ where: { fileSize: null } })
  const missingDuration = await prisma.track.count({ where: { duration: null } })

  return NextResponse.json({ total, missingFileSize, missingDuration })
}

/**
 * POST /api/admin/backfill-metadata — обрабатывает батч треков за запрос
 * Возвращает { done: true } когда все треки обработаны
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  // Берём батч треков, у которых нет fileSize ИЛИ duration
  const tracks = await prisma.track.findMany({
    where: {
      OR: [
        { fileSize: null },
        { duration: null },
      ],
    },
    select: {
      id: true,
      title: true,
      pathOriginal: true,
      filename: true,
      fileSize: true,
      duration: true,
      gridMap: true,
    },
    orderBy: { id: 'asc' },
    take: BATCH_SIZE,
  })

  if (tracks.length === 0) {
    return NextResponse.json({ done: true, processed: 0 })
  }

  // Создаём S3-клиент один раз на батч (если нужен)
  const s3Mode = isS3Enabled()
  let s3Client: any = null
  let HeadObjectCmd: any = null
  if (s3Mode) {
    const s3 = await import('@aws-sdk/client-s3')
    HeadObjectCmd = s3.HeadObjectCommand
    s3Client = new s3.S3Client({
      endpoint: process.env.S3_ENDPOINT || 'https://s3.ru1.storage.beget.cloud',
      region: process.env.S3_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
      forcePathStyle: true,
    })
  }

  const publicDir = join(process.cwd(), 'public')
  const reportsDir = join(publicDir, 'uploads', 'reports')
  let updated = 0
  let lastTitle = ''

  for (const track of tracks) {
    const data: Record<string, unknown> = {}

    // ── fileSize ──────────────────────────────────────────────────────
    if (track.fileSize == null) {
      const fileUrl = track.pathOriginal || track.filename
      const s3Key = keyFromUrl(fileUrl)

      if (s3Key && s3Client) {
        try {
          const head = await s3Client.send(new HeadObjectCmd({
            Bucket: process.env.S3_BUCKET!,
            Key: s3Key,
          }))
          if (head.ContentLength != null) {
            data.fileSize = BigInt(head.ContentLength)
          }
        } catch (e: any) {
          console.warn(`[backfill] S3 HeadObject failed #${track.id}: ${e.message}`)
        }
      } else {
        const localPath = fileUrl.startsWith('/') ? join(publicDir, fileUrl) : join(publicDir, fileUrl)
        if (existsSync(localPath)) {
          data.fileSize = BigInt(statSync(localPath).size)
        }
      }
    }

    // ── duration ──────────────────────────────────────────────────────
    if (track.duration == null) {
      const gm = track.gridMap as Record<string, unknown> | null
      if (gm && typeof gm.duration === 'number') {
        data.duration = gm.duration
      } else {
        try {
          const pathOrig = track.pathOriginal || track.filename
          const basename = pathOrig.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
          const reportPath = join(reportsDir, `${basename}_v2_analysis.json`)
          if (existsSync(reportPath)) {
            const report = JSON.parse(readFileSync(reportPath, 'utf-8'))
            if (typeof report.duration === 'number') {
              data.duration = report.duration
            }
          }
        } catch {}
      }
    }

    // ── Сохраняем ─────────────────────────────────────────────────────
    if (Object.keys(data).length > 0) {
      await prisma.track.update({ where: { id: track.id }, data: data as any })
      updated++
    } else {
      // Нет данных — ставим 0 чтобы не зацикливаться
      const fallback: Record<string, unknown> = {}
      if (track.fileSize == null) fallback.fileSize = BigInt(0)
      if (track.duration == null) fallback.duration = 0
      await prisma.track.update({ where: { id: track.id }, data: fallback as any })
    }

    lastTitle = track.title
  }

  // Проверяем, остались ли ещё
  const remaining = await prisma.track.count({
    where: { OR: [{ fileSize: null }, { duration: null }] },
  })

  return NextResponse.json({
    done: remaining === 0,
    processed: tracks.length,
    updated,
    remaining,
    lastTitle,
  })
}
