import { prisma } from '../lib/prisma'

async function checkLastTrack() {
  console.log('Checking last uploaded track...\n')

  if (!prisma) {
    console.error('❌ Prisma Client not initialized. DATABASE_URL is missing.')
    process.exit(1)
  }

  try {
    await prisma.$connect()
    console.log('✅ Database connection successful!\n')

    // Получаем последний трек
    const track = await prisma.track.findFirst({
      orderBy: {
        createdAt: 'desc',
      },
    })

    if (!track) {
      console.log('⚠️  No tracks found in database.')
      await prisma.$disconnect()
      return
    }

    console.log('📊 Last uploaded track:')
    console.log(`   ID: ${track.id}`)
    console.log(`   Title: ${track.title}`)
    console.log(`   Artist: ${track.artist || 'N/A'}`)
    console.log(`   BPM: ${track.bpm}`)
    console.log(`   Offset: ${track.offset}s`)
    console.log(`   Base BPM: ${track.baseBpm || 'N/A'}`)
    console.log(`   Base Offset: ${track.baseOffset || 'N/A'}`)
    console.log(`   Created: ${track.createdAt}`)
    console.log(`\n`)

    // Проверяем gridMap
    if (track.gridMap) {
      const gridMap = track.gridMap as any
      console.log('📋 GridMap data:')
      console.log(`   BPM: ${gridMap.bpm}`)
      console.log(`   Offset: ${gridMap.offset}s`)
      console.log(`   Total Beats: ${gridMap.totalBeats || 'N/A'}`)
      console.log(`   Downbeats count: ${gridMap.downbeats?.length || 0}`)
      console.log(`   Grid sections count: ${gridMap.grid?.length || 0}`)
      
      if (gridMap.downbeats && gridMap.downbeats.length > 0) {
        console.log(`\n   First 20 downbeats (times in seconds):`)
        gridMap.downbeats.slice(0, 20).forEach((time: number, i: number) => {
          const index = (i + 1).toString().padStart(2, ' ')
          console.log(`     [${index}] ${time.toFixed(3)}s`)
        })
        if (gridMap.downbeats.length > 20) {
          console.log(`     ... and ${gridMap.downbeats.length - 20} more`)
        }
        
        // Вычисляем интервалы между downbeats
        if (gridMap.downbeats.length > 1) {
          console.log(`\n   Intervals between downbeats (first 10):`)
          for (let i = 0; i < Math.min(10, gridMap.downbeats.length - 1); i++) {
            const interval = gridMap.downbeats[i + 1] - gridMap.downbeats[i]
            const expectedInterval = 2 * (60 / gridMap.bpm) // 2 beats между downbeats
            console.log(`     [${i + 1}] ${interval.toFixed(3)}s (expected: ${expectedInterval.toFixed(3)}s, diff: ${(interval - expectedInterval).toFixed(3)}s)`)
          }
        }
      }
      
      if (gridMap.grid && gridMap.grid.length > 0) {
        console.log(`\n   Grid sections:`)
        gridMap.grid.forEach((section: any, i: number) => {
          console.log(`     [${i + 1}] ${section.type.toUpperCase()}: start=${section.start.toFixed(3)}s, beats=${section.beats}`)
        })
      }
    } else {
      console.log('⚠️  No gridMap data (using fallback beat grid)')
    }

    console.log(`\n`)

    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

checkLastTrack()

