/**
 * Скрипт для экспорта треков из базы данных
 * 
 * Использование:
 *   npx ts-node scripts/export-tracks.ts           # CSV в консоль
 *   npx ts-node scripts/export-tracks.ts --json    # JSON в консоль
 *   npx ts-node scripts/export-tracks.ts --file    # Сохранить в файл
 * 
 * Или через tsx:
 *   npx tsx scripts/export-tracks.ts
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

async function exportTracks() {
  const args = process.argv.slice(2)
  const isJson = args.includes('--json')
  const saveToFile = args.includes('--file')

  try {
    const tracks = await prisma.track.findMany({
      select: {
        id: true,
        title: true,
        artist: true,
        bpm: true,
        offset: true,
        baseBpm: true,
        baseOffset: true,
        filename: true,
        isProcessed: true,
        createdAt: true,
      },
      orderBy: {
        title: 'asc',
      },
    })

    console.log(`\n📊 Найдено треков: ${tracks.length}\n`)

    if (tracks.length === 0) {
      console.log('База данных пуста.')
      return
    }

    if (isJson) {
      const jsonData = {
        exported_at: new Date().toISOString(),
        total_tracks: tracks.length,
        tracks: tracks.map(track => ({
          id: track.id,
          title: track.title,
          artist: track.artist || '',
          bpm: track.bpm,
          offset: track.offset,
          baseBpm: track.baseBpm,
          baseOffset: track.baseOffset,
          filename: track.filename,
          isProcessed: track.isProcessed,
          createdAt: track.createdAt,
        }))
      }

      const output = JSON.stringify(jsonData, null, 2)

      if (saveToFile) {
        const filename = `tracks_export_${new Date().toISOString().split('T')[0]}.json`
        const filepath = path.join(process.cwd(), 'public', 'uploads', filename)
        fs.writeFileSync(filepath, output, 'utf-8')
        console.log(`✅ Сохранено в: ${filepath}`)
      } else {
        console.log(output)
      }
    } else {
      // CSV формат
      const csvHeader = 'ID,Название,Исполнитель,BPM,Offset,Base BPM,Base Offset,Обработан'
      
      const escapeCSV = (value: string | number | boolean | null | Date) => {
        if (value === null || value === undefined) return ''
        if (value instanceof Date) return value.toISOString()
        const str = String(value)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }
      
      const csvRows = tracks.map(track => 
        [
          track.id,
          escapeCSV(track.title),
          escapeCSV(track.artist),
          track.bpm,
          track.offset.toFixed(2),
          track.baseBpm ?? '',
          track.baseOffset?.toFixed(2) ?? '',
          track.isProcessed ? 'Да' : 'Нет',
        ].join(',')
      )

      const csv = [csvHeader, ...csvRows].join('\n')

      if (saveToFile) {
        const filename = `tracks_export_${new Date().toISOString().split('T')[0]}.csv`
        const filepath = path.join(process.cwd(), 'public', 'uploads', filename)
        // BOM для корректного отображения кириллицы в Excel
        fs.writeFileSync(filepath, '\uFEFF' + csv, 'utf-8')
        console.log(`✅ Сохранено в: ${filepath}`)
      } else {
        console.log(csv)
      }

      // Дополнительная статистика
      console.log('\n--- Статистика ---')
      const bpms = tracks.map(t => t.bpm).filter(b => b > 0)
      console.log(`Средний BPM: ${Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length)}`)
      console.log(`Диапазон BPM: ${Math.min(...bpms)} - ${Math.max(...bpms)}`)
      console.log(`Обработано (stems): ${tracks.filter(t => t.isProcessed).length} из ${tracks.length}`)
    }

  } catch (error) {
    console.error('❌ Ошибка:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

exportTracks()
