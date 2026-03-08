import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

/** POST /api/admin/clusters/set-primary — установить главный трек */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  const { trackId, clusterId } = await request.json()

  if (!trackId || !clusterId) {
    return NextResponse.json({ error: 'trackId and clusterId required' }, { status: 400 })
  }

  // Проверяем, что трек принадлежит кластеру
  const track = await prisma.track.findFirst({
    where: { id: trackId, clusterId },
  })

  if (!track) {
    return NextResponse.json({ error: 'Трек не найден в этом кластере' }, { status: 404 })
  }

  await prisma.$transaction([
    // Снимаем primary со всех треков кластера
    prisma.track.updateMany({
      where: { clusterId },
      data: { isPrimary: false },
    }),
    // Ставим primary на выбранный
    prisma.track.update({
      where: { id: trackId },
      data: { isPrimary: true },
    }),
  ])

  return NextResponse.json({ success: true })
}
