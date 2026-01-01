import { prisma } from '../lib/prisma'
import { readdir, stat, rm } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

async function clearTracks() {
  console.log('⚠️  Clearing all tracks from database and files...\n')

  if (!prisma) {
    console.error('❌ Prisma Client not initialized. DATABASE_URL is missing.')
    process.exit(1)
  }

  try {
    // Проверяем подключение
    await prisma.$connect()
    console.log('✅ Database connection successful!\n')

    // Получаем все треки для удаления файлов
    const tracks = await prisma.track.findMany()
    console.log(`📊 Found ${tracks.length} tracks in database\n`)

    if (tracks.length === 0) {
      console.log('✅ Database is already empty.')
    } else {
      // Удаляем физические файлы
      console.log('🗑️  Deleting physical files...\n')
      const publicDir = join(process.cwd(), 'public')
      const uploadsRawDir = join(publicDir, 'uploads', 'raw')
      const uploadsStemsDir = join(publicDir, 'uploads', 'stems')

      // Удаляем файлы из uploads/raw
      if (existsSync(uploadsRawDir)) {
        try {
          const files = await readdir(uploadsRawDir)
          for (const file of files) {
            const filePath = join(uploadsRawDir, file)
            const stats = await stat(filePath)
            if (stats.isFile()) {
              await rm(filePath)
              console.log(`  ✅ Deleted: ${file}`)
            }
          }
        } catch (error: any) {
          console.warn(`  ⚠️  Error deleting files from uploads/raw: ${error.message}`)
        }
      }

      // Удаляем папки с stems (результаты разбивки Demucs)
      if (existsSync(uploadsStemsDir)) {
        try {
          const items = await readdir(uploadsStemsDir)
          for (const item of items) {
            const itemPath = join(uploadsStemsDir, item)
            const stats = await stat(itemPath)
            if (stats.isDirectory()) {
              await rm(itemPath, { recursive: true, force: true })
              console.log(`  ✅ Deleted directory: ${item}`)
            } else if (stats.isFile()) {
              await rm(itemPath)
              console.log(`  ✅ Deleted file: ${item}`)
            }
          }
        } catch (error: any) {
          console.warn(`  ⚠️  Error deleting files from uploads/stems: ${error.message}`)
        }
      }

      console.log('\n✅ All physical files deleted!\n')

      // Удаляем все треки из базы
      const result = await prisma.track.deleteMany({})
      console.log(`✅ Deleted ${result.count} tracks from database\n`)
    }

    await prisma.$disconnect()
    console.log('✅ Database and files cleared successfully!')
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

clearTracks()

