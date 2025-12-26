import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Пример данных для тестирования
  // В реальном проекте треки будут добавляться через админ-панель или API
  
  console.log('Seeding database...')

  // Очищаем существующие данные (опционально)
  await prisma.track.deleteMany()

  // Добавляем тестовые треки
  const tracks = [
    {
      title: 'Dancing In The Moonlight',
      artist: 'Prince Royce',
      filename: 'Dancing In The Moonlight - Prince Royce.mp3',
      bpm: 120, // Примерное значение, нужно будет определить точно
      offset: 0.0, // Примерное значение, нужно будет определить точно
      isFree: true,
    },
  ]

  for (const track of tracks) {
    await prisma.track.create({
      data: track,
    })
  }

  console.log('Database seeded successfully!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

