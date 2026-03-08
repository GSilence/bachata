import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

/** POST /api/admin/clusters/remove-track — убрать трек из кластера
 *  body: { trackId, clusterId, exclude?: boolean }
 *  exclude=true → clusterExcluded=true (не попадёт при пересканировании)
 *  exclude=false (по умолчанию) → "бездомный", будет переоценён при следующем скане
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

  const { trackId, clusterId, exclude = false } = await request.json()

  if (!trackId || !clusterId) {
    return NextResponse.json({ error: 'trackId and clusterId required' }, { status: 400 })
  }

  const track = await prisma.track.findFirst({
    where: { id: trackId, clusterId },
  })

  if (!track) {
    return NextResponse.json({ error: 'Трек не найден в этом кластере' }, { status: 404 })
  }

  await prisma.$transaction(async (tx) => {
    // Убираем трек из кластера
    await tx.track.update({
      where: { id: trackId },
      data: {
        clusterId: null,
        isPrimary: false,
        clusterExcluded: exclude,
      },
    })

    // Если в кластере осталось < 2 треков — удаляем кластер
    const remaining = await tx.track.count({ where: { clusterId } })
    if (remaining < 2) {
      // Снимаем привязку с оставшихся
      await tx.track.updateMany({
        where: { clusterId },
        data: { clusterId: null, isPrimary: false },
      })
      await tx.cluster.delete({ where: { id: clusterId } })
    }
  })

  return NextResponse.json({ success: true })
}
