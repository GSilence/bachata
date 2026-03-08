import { rm, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { keyFromUrl, deleteFile as deleteS3File, isS3Enabled } from '@/lib/storage'

interface TrackForDeletion {
  id: number
  pathOriginal: string | null
  pathVocals: string | null
  pathDrums: string | null
  pathBass: string | null
  pathOther: string | null
  isProcessed: boolean
}

async function deleteAudioFile(urlOrPath: string) {
  const publicDir = join(process.cwd(), 'public')
  const key = keyFromUrl(urlOrPath)
  if (key && isS3Enabled()) {
    try {
      await deleteS3File(key)
    } catch (e: any) {
      console.warn(`S3 delete error: ${e.message}`)
    }
  } else {
    const localPath = urlOrPath.startsWith('/')
      ? join(publicDir, urlOrPath)
      : join(publicDir, urlOrPath)
    if (existsSync(localPath)) {
      try {
        await rm(localPath)
      } catch (e: any) {
        console.warn(`Local delete error: ${e.message}`)
      }
    }
  }
}

/** Удаляет все файлы трека: оригинал, стемы, репорты. НЕ удаляет запись из БД. */
export async function deleteTrackFiles(track: TrackForDeletion) {
  const publicDir = join(process.cwd(), 'public')

  // Оригинальный аудиофайл
  if (track.pathOriginal) {
    await deleteAudioFile(track.pathOriginal)
  }

  // Report-файлы (все с префиксом {basename}_*)
  if (track.pathOriginal) {
    const basename = track.pathOriginal
      .replace(/^.*[\\/]/, '')
      .replace(/\.[^.]+$/, '')
    const reportsDir = join(publicDir, 'uploads', 'reports')
    if (existsSync(reportsDir)) {
      try {
        const files = await readdir(reportsDir)
        const toDelete = files.filter((f) => f.startsWith(basename + '_'))
        for (const f of toDelete) {
          try {
            await rm(join(reportsDir, f))
          } catch (e: any) {
            console.warn(`Error deleting report file ${f}: ${e.message}`)
          }
        }
      } catch (e: any) {
        console.warn(`Error reading reports directory: ${e.message}`)
      }
    }
  }

  // Stems
  if (track.isProcessed) {
    const stemsDir = join(publicDir, 'uploads', 'stems')
    const trackStemsDir = join(
      stemsDir,
      track.pathOriginal?.replace(/^uploads\/raw\//, '').replace(/\.[^/.]+$/, '') ||
        `track-${track.id}`
    )
    if (existsSync(trackStemsDir)) {
      try {
        await rm(trackStemsDir, { recursive: true, force: true })
      } catch (e: any) {
        console.warn(`Error deleting stems directory: ${e.message}`)
      }
    }

    const stemFiles = [
      track.pathVocals,
      track.pathDrums,
      track.pathBass,
      track.pathOther,
    ].filter(Boolean) as string[]

    for (const stemPath of stemFiles) {
      await deleteAudioFile(stemPath)
    }
  }
}
