import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'

/** GET /api/admin/clusters — список кластеров с треками */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
  }

  const clusters = await prisma.cluster.findMany({
    include: {
      tracks: {
        select: {
          id: true,
          title: true,
          artist: true,
          bpm: true,
          duration: true,
          fileSize: true,
          isPrimary: true,
          filename: true,
          pathOriginal: true,
          trackStatus: true,
        },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { updatedAt: 'desc' },
  })

  // Фильтруем пустые/одиночные кластеры
  const valid = clusters.filter(c => c.tracks.length >= 2)

  // BigInt → Number для JSON
  const result = valid.map(c => ({
    ...c,
    tracks: c.tracks.map(t => ({
      ...t,
      fileSize: t.fileSize != null ? Number(t.fileSize) : null,
    })),
  }))

  return NextResponse.json({ clusters: result, total: result.length })
}
