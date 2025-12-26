import { prisma } from '../lib/prisma'

async function clearTracks() {
  console.log('⚠️  Clearing all tracks from database...\n')

  if (!prisma) {
    console.error('❌ Prisma Client not initialized. DATABASE_URL is missing.')
    process.exit(1)
  }

  try {
    // Проверяем подключение
    await prisma.$connect()
    console.log('✅ Database connection successful!\n')

    // Подсчитываем количество треков
    const count = await prisma.track.count()
    console.log(`📊 Found ${count} tracks in database\n`)

    if (count === 0) {
      console.log('✅ Database is already empty.')
      await prisma.$disconnect()
      return
    }

    // Удаляем все треки
    const result = await prisma.track.deleteMany({})
    console.log(`✅ Deleted ${result.count} tracks from database\n`)

    await prisma.$disconnect()
    console.log('✅ Database cleared successfully!')
  } catch (error) {
    console.error('❌ Database error:', error)
    process.exit(1)
  }
}

clearTracks()

