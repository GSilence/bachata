import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'csv'
    
    // Динамический импорт Prisma
    const { prisma } = await import('@/lib/prisma')
    
    if (!prisma) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
    }

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

    if (format === 'json') {
      // Возвращаем JSON
      return NextResponse.json({
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
      }, {
        headers: {
          'Content-Disposition': `attachment; filename="tracks_export_${new Date().toISOString().split('T')[0]}.json"`,
        }
      })
    }

    // CSV формат
    const csvHeader = 'ID,Название,Исполнитель,BPM,Offset,Base BPM,Base Offset,Файл,Обработан,Дата добавления'
    const csvRows = tracks.map(track => {
      // Экранируем значения для CSV
      const escapeCSV = (value: string | number | boolean | null | Date) => {
        if (value === null || value === undefined) return ''
        if (value instanceof Date) return value.toISOString()
        const str = String(value)
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }
      
      return [
        track.id,
        escapeCSV(track.title),
        escapeCSV(track.artist),
        track.bpm,
        track.offset,
        track.baseBpm ?? '',
        track.baseOffset ?? '',
        escapeCSV(track.filename),
        track.isProcessed ? 'Да' : 'Нет',
        escapeCSV(track.createdAt),
      ].join(',')
    })

    const csv = [csvHeader, ...csvRows].join('\n')
    
    // Добавляем BOM для корректного отображения кириллицы в Excel
    const bom = '\uFEFF'
    
    return new NextResponse(bom + csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tracks_export_${new Date().toISOString().split('T')[0]}.csv"`,
      }
    })
  } catch (error) {
    console.error('Error exporting tracks:', error)
    return NextResponse.json({ error: 'Failed to export tracks' }, { status: 500 })
  }
}
