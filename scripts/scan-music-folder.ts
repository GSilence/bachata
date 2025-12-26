import { prisma } from '../lib/prisma'
import { readdir } from 'fs/promises'
import { join } from 'path'

async function scanMusicFolder() {
  console.log('Scanning music folder...\n')

  if (!prisma) {
    console.error('❌ Prisma Client not initialized. DATABASE_URL is missing.')
    process.exit(1)
  }

  try {
    // Получаем список файлов из папки public/music
    const musicDir = join(process.cwd(), 'public', 'music')
    const files = await readdir(musicDir)
    
    // Фильтруем только MP3 файлы
    const mp3Files = files.filter(file => file.toLowerCase().endsWith('.mp3'))
    
    console.log(`📁 Found ${mp3Files.length} MP3 files in public/music/:\n`)
    mp3Files.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`)
    })

    // Получаем существующие треки из БД
    const existingTracks = await prisma.track.findMany({
      select: {
        filename: true,
      },
    })
    const existingFilenames = new Set(existingTracks.map(t => t.filename))

    // Находим новые файлы
    const newFiles = mp3Files.filter(file => !existingFilenames.has(file))

    if (newFiles.length === 0) {
      console.log('\n✅ All files are already in the database.')
      await prisma.$disconnect()
      return
    }

    console.log(`\n🆕 Found ${newFiles.length} new file(s) not in database:`)
    newFiles.forEach((file, index) => {
      console.log(`${index + 1}. ${file}`)
    })

    // Добавляем новые треки в БД с дефолтными значениями
    console.log('\n📝 Adding new tracks to database...\n')
    
    for (const filename of newFiles) {
      // Извлекаем название и артиста из имени файла
      let nameWithoutExt = filename.replace(/\.mp3$/i, '')
      
      // Убираем префикс номера трека (например, "02 ")
      nameWithoutExt = nameWithoutExt.replace(/^\d+\s+/, '').trim()
      
      let title = nameWithoutExt
      let artist: string | null = null
      
      // Пробуем разобрать формат "Artist - Title"
      const parts = nameWithoutExt.split(' - ')
      
      if (parts.length >= 2) {
        // Обычно формат: "Artist - Title"
        // Если первая часть короткая (<= 4 слова) и не начинается с цифры, это артист
        const firstPart = parts[0].trim()
        const lastPart = parts[parts.length - 1].trim()
        
        if (firstPart.split(/\s+/).length <= 4 && !/^\d+/.test(firstPart)) {
          artist = firstPart
          title = lastPart
        } else {
          // Иначе считаем весь файл названием
          title = nameWithoutExt
        }
      }

      const track = await prisma.track.create({
        data: {
          title: title,
          artist: artist,
          filename: filename,
          bpm: 120, // Дефолтное значение, нужно будет обновить вручную
          offset: 0, // Дефолтное значение, нужно будет обновить вручную
          isFree: true,
        },
      })

      console.log(`✅ Added: ${track.title}${track.artist ? ` - ${track.artist}` : ''}`)
      console.log(`   Filename: ${track.filename}`)
      console.log(`   ⚠️  Default BPM: ${track.bpm}, Offset: ${track.offset}s (update manually)`)
      console.log('')
    }

    console.log('✅ Done!')
    await prisma.$disconnect()
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  }
}

scanMusicFolder()

