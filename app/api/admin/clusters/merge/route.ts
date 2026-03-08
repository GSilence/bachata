import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { deleteTrackFiles } from '@/lib/deleteTrackFiles'

/** POST /api/admin/clusters/merge — объединить кластер: оставить primary, удалить остальные */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  const { clusterId } = await request.json()

  if (!clusterId) {
    return NextResponse.json({ error: 'clusterId required' }, { status: 400 })
  }

  const tracks = await prisma.track.findMany({
    where: { clusterId },
  })

  if (tracks.length < 2) {
    return NextResponse.json({ error: 'Кластер пуст или содержит 1 трек' }, { status: 400 })
  }

  const primary = tracks.find(t => t.isPrimary)
  if (!primary) {
    return NextResponse.json({ error: 'Не выбран главный трек' }, { status: 400 })
  }

  const duplicates = tracks.filter(t => t.id !== primary.id)
  const deletedIds: number[] = []

  await prisma.$transaction(async (tx) => {
    for (const dup of duplicates) {
      // Перенос UserTrack
      const userTracks = await tx.userTrack.findMany({ where: { trackId: dup.id } })
      for (const ut of userTracks) {
        // upsert: если у пользователя уже есть primary — пропускаем
        const exists = await tx.userTrack.findFirst({
          where: { userId: ut.userId, trackId: primary.id },
        })
        if (!exists) {
          await tx.userTrack.create({
            data: { userId: ut.userId, trackId: primary.id },
          })
        }
      }

      // Перенос PlaylistItem
      const playlistItems = await tx.playlistItem.findMany({ where: { trackId: dup.id } })
      for (const pi of playlistItems) {
        const exists = await tx.playlistItem.findFirst({
          where: { playlistId: pi.playlistId, trackId: primary.id },
        })
        if (!exists) {
          await tx.playlistItem.create({
            data: { playlistId: pi.playlistId, trackId: primary.id, position: pi.position },
          })
        }
      }

      // Суммируем прослушивания
      await tx.track.update({
        where: { id: primary.id },
        data: { playsTotal: { increment: dup.playsTotal } },
      })

      // Удаляем запись трека (каскад: TrackLog, ModQueue, UserTrack, PlaylistItem)
      await tx.track.delete({ where: { id: dup.id } })
      deletedIds.push(dup.id)
    }

    // Удаляем кластер, снимаем привязку с primary
    await tx.track.update({
      where: { id: primary.id },
      data: { clusterId: null, isPrimary: false },
    })
    await tx.cluster.delete({ where: { id: clusterId } })
  })

  // Удаляем файлы дубликатов (вне транзакции — файлы не откатишь)
  for (const dup of duplicates) {
    await deleteTrackFiles(dup)
  }

  return NextResponse.json({
    merged: true,
    primaryTrackId: primary.id,
    deletedTrackIds: deletedIds,
  })
}
