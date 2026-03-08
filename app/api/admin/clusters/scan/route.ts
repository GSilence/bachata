import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { buildClusters, ClusterParams } from '@/lib/clustering'

/** POST /api/admin/clusters/scan — запуск кластеризации */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  const body = await request.json() as ClusterParams

  // Валидация
  if (!body.fileSizeEnabled && !body.durationEnabled && !body.artistEnabled && !body.titleEnabled) {
    return NextResponse.json({ error: 'Нужно включить хотя бы один критерий' }, { status: 400 })
  }

  // Загружаем все треки
  const tracks = await prisma.track.findMany({
    select: {
      id: true,
      title: true,
      artist: true,
      duration: true,
      fileSize: true,
      clusterId: true,
      isPrimary: true,
      clusterExcluded: true,
    },
  })

  // Кластеризуем
  const clusterResults = buildClusters(tracks, body)

  // Транзакция: очищаем старые кластеры, создаём новые
  await prisma.$transaction(async (tx) => {
    // Снимаем все clusterId и isPrimary
    await tx.track.updateMany({
      where: { clusterExcluded: false },
      data: { clusterId: null, isPrimary: false },
    })

    // Удаляем все старые кластеры
    await tx.cluster.deleteMany({})

    // Создаём новые кластеры
    for (const cr of clusterResults) {
      const cluster = await tx.cluster.create({ data: {} })

      // Привязываем треки
      await tx.track.updateMany({
        where: { id: { in: cr.trackIds } },
        data: { clusterId: cluster.id, isPrimary: false },
      })

      // Ставим primary
      if (cr.primaryId) {
        await tx.track.update({
          where: { id: cr.primaryId },
          data: { isPrimary: true },
        })
      }
    }
  })

  return NextResponse.json({
    clustersCreated: clusterResults.length,
    tracksProcessed: tracks.filter(t => !t.clusterExcluded).length,
    tracksClustered: clusterResults.reduce((sum, c) => sum + c.trackIds.length, 0),
  })
}
