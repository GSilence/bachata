import { NextResponse } from 'next/server'

export async function GET() {
  try {
    // Динамический импорт Prisma, чтобы избежать ошибок при инициализации
    const { prisma } = await import('@/lib/prisma')
    
    // Проверяем наличие Prisma Client перед использованием
    if (!prisma) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Prisma Client not initialized (DATABASE_URL not configured). Returning empty array.')
      }
      return NextResponse.json([])
    }

    const tracks = await prisma.track.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    })

    return NextResponse.json(tracks)
  } catch (error) {
    // Логируем только в development
    if (process.env.NODE_ENV === 'development') {
      console.error('Error fetching tracks:', error)
    }
    
    // Всегда возвращаем пустой массив при ошибке, чтобы приложение работало
    const errorMessage = error instanceof Error ? error.message : String(error)
    const errorCode = (error as { code?: string })?.code
    
    // Для ошибок подключения к БД просто возвращаем пустой массив
    if (errorCode === 'P1001' || 
        errorCode === 'P1000' ||
        errorMessage.includes('connect') || 
        errorMessage.includes('DATABASE_URL') ||
        errorMessage.includes('Can\'t reach database')) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Database connection error. Returning empty array.')
      }
      return NextResponse.json([])
    }
    
    // Для всех других ошибок тоже возвращаем пустой массив
    return NextResponse.json([])
  }
}

