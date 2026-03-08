export interface ClusterParams {
  fileSizeEnabled: boolean
  fileSizePercent: number      // допуск в %
  durationEnabled: boolean
  durationSeconds: number      // допуск в секундах
  artistEnabled: boolean       // точное совпадение (case-insensitive)
  titleEnabled: boolean        // общие слова
}

export interface TrackForClustering {
  id: number
  title: string
  artist: string | null
  duration: number | null
  fileSize: bigint | number | null
  clusterId: number | null
  isPrimary: boolean
  clusterExcluded: boolean
}

// ─── Union-Find ──────────────────────────────────────────────────────────────

class UnionFind {
  private parent: Map<number, number> = new Map()
  private rank: Map<number, number> = new Map()

  add(x: number) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x)
      this.rank.set(x, 0)
    }
  }

  find(x: number): number {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x)!))
    }
    return this.parent.get(x)!
  }

  union(a: number, b: number) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra === rb) return
    const rankA = this.rank.get(ra)!
    const rankB = this.rank.get(rb)!
    if (rankA < rankB) {
      this.parent.set(ra, rb)
    } else if (rankA > rankB) {
      this.parent.set(rb, ra)
    } else {
      this.parent.set(rb, ra)
      this.rank.set(ra, rankA + 1)
    }
  }

  getComponents(): Map<number, number[]> {
    const components = new Map<number, number[]>()
    for (const x of this.parent.keys()) {
      const root = this.find(x)
      if (!components.has(root)) components.set(root, [])
      components.get(root)!.push(x)
    }
    return components
  }
}

// ─── Matching ────────────────────────────────────────────────────────────────

function normalizeStr(s: string): string {
  return s.toLowerCase().trim()
}

function extractWords(s: string): Set<string> {
  return new Set(
    normalizeStr(s)
      .split(/[^a-zа-яёñ0-9]+/i)
      .filter(w => w.length >= 2)
  )
}

function tracksMatch(a: TrackForClustering, b: TrackForClustering, params: ClusterParams): boolean {
  // Размер файла: ±N%
  if (params.fileSizeEnabled) {
    if (a.fileSize == null || b.fileSize == null) return false
    const sA = Number(a.fileSize)
    const sB = Number(b.fileSize)
    if (sA === 0 && sB === 0) { /* оба 0 — совпадение */ }
    else {
      const maxSize = Math.max(sA, sB)
      const diffPct = Math.abs(sA - sB) / maxSize * 100
      if (diffPct > params.fileSizePercent) return false
    }
  }

  // Длительность: ±N секунд
  if (params.durationEnabled) {
    if (a.duration == null || b.duration == null) return false
    if (Math.abs(a.duration - b.duration) > params.durationSeconds) return false
  }

  // Артист: точное совпадение
  if (params.artistEnabled) {
    if (!a.artist || !b.artist) return false
    if (normalizeStr(a.artist) !== normalizeStr(b.artist)) return false
  }

  // Название: общие слова (Jaccard ≥ 0.5)
  if (params.titleEnabled) {
    const wordsA = extractWords(a.title)
    const wordsB = extractWords(b.title)
    if (wordsA.size === 0 || wordsB.size === 0) return false
    let intersection = 0
    for (const w of wordsA) if (wordsB.has(w)) intersection++
    const unionSize = wordsA.size + wordsB.size - intersection
    if (unionSize === 0 || intersection / unionSize < 0.5) return false
  }

  return true
}

// ─── Full Scan ───────────────────────────────────────────────────────────────

export interface ClusterResult {
  trackIds: number[]
  primaryId: number | null // id трека с isPrimary, или lowest id
}

export function buildClusters(
  tracks: TrackForClustering[],
  params: ClusterParams
): ClusterResult[] {
  // Фильтруем исключённые
  const eligible = tracks.filter(t => !t.clusterExcluded)

  const uf = new UnionFind()
  for (const t of eligible) uf.add(t.id)

  const trackMap = new Map(eligible.map(t => [t.id, t]))

  // O(n^2) сравнение — при < 10K треков это ок
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      if (tracksMatch(eligible[i], eligible[j], params)) {
        uf.union(eligible[i].id, eligible[j].id)
      }
    }
  }

  const components = uf.getComponents()
  const results: ClusterResult[] = []

  for (const [, ids] of components) {
    if (ids.length < 2) continue

    ids.sort((a, b) => a - b)

    // Определяем primary: если кто-то уже isPrimary — берём его (первый найденный)
    // Иначе — lowest id
    const existingPrimary = ids.find(id => trackMap.get(id)!.isPrimary)
    const primaryId = existingPrimary ?? ids[0]

    results.push({ trackIds: ids, primaryId })
  }

  return results
}
