import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Ленивая инициализация Prisma Client с обработкой отсутствия DATABASE_URL
function createPrismaClient(): PrismaClient | null {
  // Проверяем наличие DATABASE_URL
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('DATABASE_URL not found. Prisma Client will not be initialized.')
    }
    return null
  }
  
  try {
    const client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    })
    return client
  } catch (error) {
    // Не логируем ошибку в production, чтобы не засорять логи
    if (process.env.NODE_ENV === 'development') {
      console.warn('Failed to initialize Prisma Client:', error)
    }
    return null
  }
}

// Создаем Prisma Client только если DATABASE_URL установлен
// Используем ленивую инициализацию, чтобы избежать ошибок при импорте
let prismaInstance: PrismaClient | null = null

function getPrisma(): PrismaClient | null {
  if (prismaInstance !== null) {
    return prismaInstance
  }

  // Проверяем глобальный кэш
  if (globalForPrisma.prisma) {
    prismaInstance = globalForPrisma.prisma
    return prismaInstance
  }

  // Создаем новый экземпляр
  prismaInstance = createPrismaClient()

  if (process.env.NODE_ENV !== 'production' && prismaInstance) {
    globalForPrisma.prisma = prismaInstance
  }

  return prismaInstance
}

// Экспортируем функцию получения Prisma Client
export const prisma = getPrisma()

