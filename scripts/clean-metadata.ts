/**
 * Clean metadata for all tracks:
 * 1. Clear metaComment (set to null)
 * 2. Strip URLs and emojis from title, artist, metaTitle, metaArtist, metaAlbum
 *
 * Usage:
 *   npx tsx scripts/clean-metadata.ts          # dry-run (preview changes)
 *   npx tsx scripts/clean-metadata.ts --apply   # apply changes to DB
 *
 * On server:
 *   cd /opt/bachata
 *   npx tsx scripts/clean-metadata.ts --apply
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// URL patterns (same as process-track sanitizeMeta)
const URL_PATTERNS = [
  /https?:\/\/\S+/gi,
  /www\.\S+/gi,
  /\S+\.(ru|com|org|net|info|biz|me|pro|tv|cc|io|co|xyz|site|online|store|shop|club|top|link|space|live|music)\b\S*/gi,
];

// Emoji pattern — matches most emoji ranges
const EMOJI_PATTERN = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}\u{200D}\u{FE0F}\u{20E3}\u{E0020}-\u{E007F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2702}-\u{27B0}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}]/gu;

function cleanString(value: string | null): string | null {
  if (!value) return value;
  let s = value;

  // Strip URLs
  for (const pattern of URL_PATTERNS) {
    s = s.replace(pattern, "");
  }

  // Strip emojis
  s = s.replace(EMOJI_PATTERN, "");

  // Clean up trailing artifacts after URL removal: "Title - ()" → "Title"
  s = s
    .replace(/\(\s*\)/g, "")         // empty parens
    .replace(/\[\s*\]/g, "")         // empty brackets
    .replace(/\(\s*$/g, "")          // unclosed trailing paren
    .replace(/\[\s*$/g, "")          // unclosed trailing bracket
    .replace(/\s*[-–—]+\s*$/g, "")   // trailing dashes
    .replace(/\s+/g, " ")
    .trim();

  return s || null;
}

async function main() {
  const applyMode = process.argv.includes("--apply");

  console.log(`Mode: ${applyMode ? "APPLY (writing to DB)" : "DRY-RUN (preview only)"}`);
  console.log("---");

  const tracks = await prisma.track.findMany({
    select: {
      id: true,
      title: true,
      artist: true,
      metaTitle: true,
      metaArtist: true,
      metaAlbum: true,
      metaComment: true,
    },
  });

  console.log(`Total tracks: ${tracks.length}`);

  let commentCleared = 0;
  let titleCleaned = 0;
  let artistCleaned = 0;
  let metaTitleCleaned = 0;
  let metaArtistCleaned = 0;
  let metaAlbumCleaned = 0;

  for (const track of tracks) {
    const updates: Record<string, string | null> = {};

    // 1. Clear metaComment
    if (track.metaComment != null) {
      updates.metaComment = null;
      commentCleared++;
    }

    // 2. Clean title
    const cleanedTitle = cleanString(track.title);
    if (cleanedTitle !== track.title && cleanedTitle) {
      updates.title = cleanedTitle;
      titleCleaned++;
      if (!applyMode) {
        console.log(`  #${track.id} title: "${track.title}" → "${cleanedTitle}"`);
      }
    }

    // 3. Clean artist
    const cleanedArtist = cleanString(track.artist);
    if (cleanedArtist !== track.artist) {
      updates.artist = cleanedArtist;
      artistCleaned++;
      if (!applyMode) {
        console.log(`  #${track.id} artist: "${track.artist}" → "${cleanedArtist}"`);
      }
    }

    // 4. Clean metaTitle
    const cleanedMetaTitle = cleanString(track.metaTitle);
    if (cleanedMetaTitle !== track.metaTitle) {
      updates.metaTitle = cleanedMetaTitle;
      metaTitleCleaned++;
      if (!applyMode) {
        console.log(`  #${track.id} metaTitle: "${track.metaTitle}" → "${cleanedMetaTitle}"`);
      }
    }

    // 5. Clean metaArtist
    const cleanedMetaArtist = cleanString(track.metaArtist);
    if (cleanedMetaArtist !== track.metaArtist) {
      updates.metaArtist = cleanedMetaArtist;
      metaArtistCleaned++;
      if (!applyMode) {
        console.log(`  #${track.id} metaArtist: "${track.metaArtist}" → "${cleanedMetaArtist}"`);
      }
    }

    // 6. Clean metaAlbum
    const cleanedMetaAlbum = cleanString(track.metaAlbum);
    if (cleanedMetaAlbum !== track.metaAlbum) {
      updates.metaAlbum = cleanedMetaAlbum;
      metaAlbumCleaned++;
      if (!applyMode) {
        console.log(`  #${track.id} metaAlbum: "${track.metaAlbum}" → "${cleanedMetaAlbum}"`);
      }
    }

    // Apply updates
    if (Object.keys(updates).length > 0 && applyMode) {
      await prisma.track.update({
        where: { id: track.id },
        data: updates,
      });
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Comments cleared: ${commentCleared}`);
  console.log(`Titles cleaned:   ${titleCleaned}`);
  console.log(`Artists cleaned:  ${artistCleaned}`);
  console.log(`MetaTitle cleaned:  ${metaTitleCleaned}`);
  console.log(`MetaArtist cleaned: ${metaArtistCleaned}`);
  console.log(`MetaAlbum cleaned:  ${metaAlbumCleaned}`);

  if (!applyMode && (titleCleaned + artistCleaned + metaTitleCleaned + metaArtistCleaned + metaAlbumCleaned) > 0) {
    console.log("\nRun with --apply to save changes to database.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
