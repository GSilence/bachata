/**
 * Shared Prisma query builders for track listing and navigation.
 * Used by GET /api/tracks and POST /api/tracks/navigate.
 */

// Лёгкий select — без gridMap и тяжёлых полей
export const LIGHT_SELECT = {
  id: true,
  title: true,
  artist: true,
  filename: true,
  bpm: true,
  offset: true,
  baseBpm: true,
  baseOffset: true,
  isFree: true,
  createdAt: true,
  pathOriginal: true,
  isProcessed: true,
  analyzerType: true,
  genreHint: true,
  rowDominancePercent: true,
  rowSwapped: true,
  hasBridges: true,
  trackStatus: true,
  hasAccents: true,
  hasMambo: true,
  metaTitle: true,
  metaArtist: true,
  metaAlbum: true,
  metaYear: true,
  metaGenre: true,
  metaComment: true,
  metaTrackNum: true,
  playsTotal: true,
  duration: true,
  fileSize: true,
  clusterId: true,
  isPrimary: true,
} as const;

// Поля, которые не должны видеть обычные пользователи
export const INTERNAL_FIELDS = [
  "rowDominancePercent",
  "rowSwapped",
  "analyzerType",
  "isProcessed",
] as const;

type PrismaWhere = Record<string, unknown>;

/**
 * Builds Prisma `where` clause from URLSearchParams.
 *
 * Params:
 *  - search: text search by title/artist (case-insensitive contains)
 *  - bridges: comma-separated "with,without,swapped"
 *  - status: comma-separated "unlistened,moderation,approved,popsa" (admin only)
 *  - accents: "1" = only tracks with accents
 *  - mambo: "1" = only tracks with mambo
 *  - dominance: comma-separated "neg,low,high"
 *  - filter: "free" (only isFree=true) — default
 */
export function buildTracksWhere(
  sp: URLSearchParams,
  isAdmin: boolean,
): PrismaWhere {
  const conditions: PrismaWhere[] = [];

  // --- Text search ---
  const search = sp.get("search")?.trim();
  if (search) {
    conditions.push({
      OR: [
        { title: { contains: search } },
        { artist: { contains: search } },
      ],
    });
  }

  // --- Playlist filter (free/my/all) ---
  const playlistFilter = sp.get("filter") ?? "free";
  if (playlistFilter === "free") {
    conditions.push({ isFree: true });
  }
  // "my" and "all" not yet implemented

  // --- Status filter (admin only) ---
  if (isAdmin) {
    const statusRaw = sp.get("status");
    if (statusRaw) {
      const statuses = statusRaw.split(",").filter(Boolean);
      if (statuses.length > 0 && statuses.length < 4) {
        conditions.push({ trackStatus: { in: statuses } });
      }
      // if all 4 selected or empty — no filter needed
    }
  } else {
    // Regular users see only approved tracks
    conditions.push({ trackStatus: "approved" });
  }

  // --- Bridge filter ---
  const bridgesRaw = sp.get("bridges");
  if (bridgesRaw) {
    const parts = new Set(bridgesRaw.split(","));
    const hasWith = parts.has("with");
    const hasWithout = parts.has("without");
    const hasSwapped = parts.has("swapped");

    // If all three are present (or none explicitly passed), no filter needed
    const allPresent = hasWith && hasWithout && hasSwapped;
    if (!allPresent) {
      const orConditions: PrismaWhere[] = [];
      if (hasWith) orConditions.push({ hasBridges: true });
      if (hasWithout) orConditions.push({ hasBridges: false });
      if (hasSwapped && isAdmin) orConditions.push({ rowSwapped: true });

      if (orConditions.length === 1) {
        conditions.push(orConditions[0]);
      } else if (orConditions.length > 1) {
        conditions.push({ OR: orConditions });
      } else {
        // None selected — show nothing
        conditions.push({ id: -1 });
      }
    }
  }

  // --- Tag filters (AND) ---
  if (sp.get("accents") === "1") {
    conditions.push({ hasAccents: true });
  }
  if (sp.get("mambo") === "1") {
    conditions.push({ hasMambo: true });
  }

  // --- Dominance buckets (admin) ---
  if (isAdmin) {
    const domRaw = sp.get("dominance");
    if (domRaw) {
      const parts = new Set(domRaw.split(","));
      const hasNeg = parts.has("neg");
      const hasLow = parts.has("low");
      const hasHigh = parts.has("high");

      const allSelected = hasNeg && hasLow && hasHigh;
      const noneSelected = !hasNeg && !hasLow && !hasHigh;

      if (!allSelected && !noneSelected) {
        const orConditions: PrismaWhere[] = [];
        if (hasNeg) orConditions.push({ rowDominancePercent: { lt: 0 } });
        if (hasLow) {
          orConditions.push({
            AND: [
              { rowDominancePercent: { gte: 0 } },
              { rowDominancePercent: { lt: 5 } },
            ],
          });
        }
        if (hasHigh) orConditions.push({ rowDominancePercent: { gte: 5 } });

        // Must have non-null rowDominancePercent
        conditions.push({
          AND: [
            { rowDominancePercent: { not: null } },
            orConditions.length === 1 ? orConditions[0] : { OR: orConditions },
          ],
        });
      }
    }
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

type PrismaOrderBy = Record<string, string | Record<string, string>>[] | Record<string, string>[];

/**
 * Builds Prisma `orderBy` from URLSearchParams.
 *
 * Params:
 *  - sort: "title" | "duration" | "date" (default "title")
 *  - sortDir: "asc" | "desc" (default "asc")
 *  - squareSort: "none" | "asc" | "desc" (default "none")
 *    When squareSort != "none", we sort hasBridges first (false before true for "non-bridge first"),
 *    then by rowDominancePercent within non-bridge tracks.
 */
export function buildTracksOrderBy(
  sp: URLSearchParams,
): Record<string, string>[] {
  const sort = sp.get("sort") ?? "title";
  const sortDir = sp.get("sortDir") === "desc" ? "desc" : "asc";
  const squareSort = sp.get("squareSort") ?? "none";

  const orderBy: Record<string, string>[] = [];

  // Square sort: group non-bridge tracks first, then sort by dominance within them
  if (squareSort !== "none") {
    // hasBridges=false (квадратные) сначала, hasBridges=true (с мостиками) потом
    orderBy.push({ hasBridges: "asc" });
    orderBy.push({ rowDominancePercent: squareSort });
  }

  // Main sort
  switch (sort) {
    case "title":
      orderBy.push({ title: sortDir });
      break;
    case "duration":
      orderBy.push({ duration: sortDir });
      break;
    case "date":
      orderBy.push({ createdAt: sortDir });
      break;
    default:
      orderBy.push({ title: sortDir });
  }

  // Stable tie-breaker
  orderBy.push({ id: sortDir });

  return orderBy;
}
