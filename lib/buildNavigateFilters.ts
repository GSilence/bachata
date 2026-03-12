/**
 * Builds the `filters` object for POST /api/tracks/navigate
 * from current playerStore state.
 */
export function buildNavigateFilters(state: {
  searchQuery: string;
  activePlaylist: string;
  playlistFilter: string;
  isAdmin: boolean;
  bridgeFilterWith: boolean;
  bridgeFilterWithout: boolean;
  bridgeFilterSwapped: boolean;
  statusFilterUnlistened: boolean;
  statusFilterModeration: boolean;
  statusFilterApproved: boolean;
  statusFilterPopsa: boolean;
  accentFilterOn: boolean;
  mamboFilterOn: boolean;
  dominanceBucketNeg: boolean;
  dominanceBucketLow: boolean;
  dominanceBucketHigh: boolean;
  playlistSortBy: string;
  sortDirection: string;
  squareSortDirection: string;
}): Record<string, string> {
  const f: Record<string, string> = {};

  if (state.searchQuery) f.search = state.searchQuery;
  if (state.activePlaylist && state.activePlaylist !== "general") {
    f.playlist = state.activePlaylist;
  } else {
    f.filter = state.playlistFilter;
  }
  f.sort = state.playlistSortBy;
  f.sortDir = state.sortDirection;
  if (state.squareSortDirection !== "none") f.squareSort = state.squareSortDirection;

  // Bridges
  const bridges: string[] = [];
  if (state.bridgeFilterWith) bridges.push("with");
  if (state.bridgeFilterWithout) bridges.push("without");
  if (state.bridgeFilterSwapped) bridges.push("swapped");
  if (bridges.length > 0 && bridges.length < 3) {
    f.bridges = bridges.join(",");
  }

  // Status (admin only)
  if (state.isAdmin) {
    const statuses: string[] = [];
    if (state.statusFilterUnlistened) statuses.push("unlistened");
    if (state.statusFilterModeration) statuses.push("moderation");
    if (state.statusFilterApproved) statuses.push("approved");
    if (state.statusFilterPopsa) statuses.push("popsa");
    if (statuses.length > 0 && statuses.length < 4) {
      f.status = statuses.join(",");
    }
  }

  // Tags
  if (state.accentFilterOn) f.accents = "1";
  if (state.mamboFilterOn) f.mambo = "1";

  // Dominance
  if (state.isAdmin) {
    const dom: string[] = [];
    if (state.dominanceBucketNeg) dom.push("neg");
    if (state.dominanceBucketLow) dom.push("low");
    if (state.dominanceBucketHigh) dom.push("high");
    if (dom.length > 0 && dom.length < 3) {
      f.dominance = dom.join(",");
    }
  }

  return f;
}
