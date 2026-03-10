import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/auth'
import { buildClusters, ClusterParams } from '@/lib/clustering'
import { findAllDuplicateClusters } from '@/lib/fingerprint'

interface ScanBody extends ClusterParams {
  fingerprintEnabled?: boolean
}

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

  const body = await request.json() as ScanBody

  const hasMetadataCriteria = body.fileSizeEnabled || body.durationEnabled || body.bpmEnabled || body.artistEnabled || body.titleEnabled
  const hasFingerprint = !!body.fingerprintEnabled

  if (!hasMetadataCriteria && !hasFingerprint) {
    return NextResponse.json({ error: 'Нужно включить хотя бы один критерий' }, { status: 400 })
  }

  // Загружаем все треки для метаданных
  const tracks = await prisma.track.findMany({
    select: {
      id: true,
      title: true,
      artist: true,
      bpm: true,
      duration: true,
      fileSize: true,
      clusterId: true,
      isPrimary: true,
      clusterExcluded: true,
    },
  })

  // Metadata clusters
  let metadataResults: { trackIds: number[]; primaryId: number | null }[] = []
  if (hasMetadataCriteria) {
    metadataResults = buildClusters(tracks, body)
  }

  // Fingerprint clusters
  let fingerprintResults: { trackIds: number[]; primaryId: number | null }[] = []
  if (hasFingerprint) {
    const { clusters: fpClusters } = await findAllDuplicateClusters(prisma)
    // Convert to same format, pick lowest id as primary
    fingerprintResults = fpClusters.map(c => {
      const ids = c.trackIds.sort((a, b) => a - b)
      // Check if any track already has isPrimary set
      const trackMap = new Map(tracks.map(t => [t.id, t]))
      const existingPrimary = ids.find(id => trackMap.get(id)?.isPrimary)
      return {
        trackIds: ids,
        primaryId: existingPrimary ?? ids[0],
      }
    })
  }

  // Merge results: union-find across all cluster results
  const allResults = [...metadataResults, ...fingerprintResults]

  // Deduplicate: if a track appears in multiple clusters, merge them
  const parentMap = new Map<number, number>()
  const rankMap = new Map<number, number>()

  function find(x: number): number {
    if (!parentMap.has(x)) { parentMap.set(x, x); rankMap.set(x, 0) }
    if (parentMap.get(x) !== x) parentMap.set(x, find(parentMap.get(x)!))
    return parentMap.get(x)!
  }
  function union(a: number, b: number) {
    const ra = find(a), rb = find(b)
    if (ra === rb) return
    const rA = rankMap.get(ra) || 0, rB = rankMap.get(rb) || 0
    if (rA < rB) parentMap.set(ra, rb)
    else if (rA > rB) parentMap.set(rb, ra)
    else { parentMap.set(rb, ra); rankMap.set(ra, rA + 1) }
  }

  // Union all tracks within each result cluster
  for (const cr of allResults) {
    for (let i = 1; i < cr.trackIds.length; i++) {
      union(cr.trackIds[0], cr.trackIds[i])
    }
  }

  // Group into final clusters
  const groups = new Map<number, Set<number>>()
  for (const cr of allResults) {
    for (const id of cr.trackIds) {
      const root = find(id)
      if (!groups.has(root)) groups.set(root, new Set())
      groups.get(root)!.add(id)
    }
  }

  // Build final cluster results
  const trackMap = new Map(tracks.map(t => [t.id, t]))
  const finalResults: { trackIds: number[]; primaryId: number | null }[] = []
  for (const [, idSet] of groups) {
    if (idSet.size < 2) continue
    const ids = Array.from(idSet).sort((a, b) => a - b)
    const existingPrimary = ids.find(id => trackMap.get(id)?.isPrimary)
    finalResults.push({ trackIds: ids, primaryId: existingPrimary ?? ids[0] })
  }

  // Транзакция: очищаем старые кластеры, создаём новые
  await prisma.$transaction(async (tx: any) => {
    // Снимаем все clusterId и isPrimary
    await tx.track.updateMany({
      where: { clusterExcluded: false },
      data: { clusterId: null, isPrimary: false },
    })

    // Удаляем все старые кластеры
    await tx.cluster.deleteMany({})

    // Создаём новые кластеры
    for (const cr of finalResults) {
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
    clustersCreated: finalResults.length,
    tracksProcessed: tracks.filter(t => !t.clusterExcluded).length,
    tracksClustered: finalResults.reduce((sum, c) => sum + c.trackIds.length, 0),
  })
}
