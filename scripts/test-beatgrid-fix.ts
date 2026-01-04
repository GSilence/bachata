import { prisma } from '../lib/prisma'
import { generateBeatGridFromDownbeats } from '../lib/beatGrid'
import type { GridMap } from '../types'

async function testBeatGridFix() {
  console.log('Testing beatGrid fix on last track...\n')

  if (!prisma) {
    console.error('❌ Prisma Client not initialized.')
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

    if (!track || !track.gridMap) {
      console.log('⚠️  No track with gridMap found.')
      await prisma.$disconnect()
      return
    }

    console.log(`📊 Testing on track: ${track.title} (BPM: ${track.bpm})\n`)

    const gridMap = track.gridMap as any as GridMap
    const duration = 200 // Примерная длительность для теста

    console.log('📋 Original downbeats:')
    console.log(`   Count: ${gridMap.downbeats?.length || 0}`)
    if (gridMap.downbeats && gridMap.downbeats.length > 0) {
      console.log(`   First 5 intervals:`)
      for (let i = 0; i < Math.min(5, gridMap.downbeats.length - 1); i++) {
        const interval = gridMap.downbeats[i + 1] - gridMap.downbeats[i]
        console.log(`     [${i + 1}] ${interval.toFixed(3)}s`)
      }
    }

    console.log(`\n🔄 Generating beatGrid...\n`)
    const beatGrid = generateBeatGridFromDownbeats(gridMap, duration)

    console.log(`✅ Generated beatGrid:`)
    console.log(`   Total beats: ${beatGrid.length}`)
    console.log(`   Expected beats (approx): ${Math.floor(duration * gridMap.bpm / 60)}`)

    // Проверяем первые 20 beats
    console.log(`\n📝 First 20 beats in beatGrid:`)
    beatGrid.slice(0, 20).forEach((beat, i) => {
      const prevTime = i > 0 ? beatGrid[i - 1].time : beat.time
      const interval = i > 0 ? (beat.time - prevTime).toFixed(3) : '-'
      console.log(`   [${(i + 1).toString().padStart(2, ' ')}] Time: ${beat.time.toFixed(3)}s, Number: ${beat.number}, Interval: ${interval}s`)
    })

    // Проверяем распределение номеров beats
    const beatCounts: { [key: number]: number } = {}
    beatGrid.forEach(beat => {
      beatCounts[beat.number] = (beatCounts[beat.number] || 0) + 1
    })

    console.log(`\n📊 Beat number distribution (first 20 beats):`)
    const first20 = beatGrid.slice(0, 20)
    const first20Counts: { [key: number]: number } = {}
    first20.forEach(beat => {
      first20Counts[beat.number] = (first20Counts[beat.number] || 0) + 1
    })
    for (let i = 1; i <= 8; i++) {
      console.log(`   Beat ${i}: ${first20Counts[i] || 0} occurrences`)
    }

    // Проверяем последовательность
    console.log(`\n🔍 Checking beat sequence (first 20):`)
    let hasError = false
    for (let i = 0; i < Math.min(20, beatGrid.length - 1); i++) {
      const current = beatGrid[i]
      const next = beatGrid[i + 1]
      const expectedNext = (current.number % 8) + 1
      
      if (next.number !== expectedNext) {
        console.log(`   ⚠️  ERROR at index ${i}: Expected ${expectedNext}, got ${next.number}`)
        hasError = true
      }
    }
    
    if (!hasError) {
      console.log(`   ✅ Beat sequence is correct!`)
    }

    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

testBeatGridFix()

