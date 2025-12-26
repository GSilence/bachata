import { prisma } from '../lib/prisma'

async function checkDatabase() {
  console.log('Checking database connection...\n')

  if (!prisma) {
    console.error('❌ Prisma Client not initialized. DATABASE_URL is missing.')
    process.exit(1)
  }

  try {
    // Проверяем подключение
    await prisma.$connect()
    console.log('✅ Database connection successful!\n')

    // Получаем все треки
    const tracks = await prisma.track.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    })

    console.log(`📊 Total tracks in database: ${tracks.length}\n`)

    if (tracks.length === 0) {
      console.log('⚠️  Database is empty. No tracks found.')
      console.log('\nTo add tracks, you need to:')
      console.log('1. Insert records into the Track table manually, or')
      console.log('2. Use the seed script: npm run db:seed, or')
      console.log('3. Create an admin interface to upload tracks\n')
    } else {
      console.log('📝 Current tracks in database:')
      tracks.forEach((track, index) => {
      console.log(`\n${index + 1}. ${track.title}`)
      console.log(`   Artist: ${track.artist || 'N/A'}`)
      console.log(`   Filename: ${track.filename}`)
      console.log(`   BPM: ${track.bpm}`)
      console.log(`   Offset: ${track.offset}s`)
      console.log(`   Free: ${track.isFree}`)
      if (track.isProcessed) {
        console.log(`   ✅ Processed via Demucs`)
        console.log(`   Original: ${track.pathOriginal || 'N/A'}`)
        console.log(`   Vocals: ${track.pathVocals ? '✓' : '✗'}`)
        console.log(`   Drums: ${track.pathDrums ? '✓' : '✗'}`)
        console.log(`   Bass: ${track.pathBass ? '✓' : '✗'}`)
        console.log(`   Other: ${track.pathOther ? '✓' : '✗'}`)
      } else {
        console.log(`   ⚠️  Not processed (using filename)`)
      }
      console.log(`   Created: ${track.createdAt}`)
      })
    }

    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Database error:', error)
    process.exit(1)
  }
}

checkDatabase()

