'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface TrackMetadata {
  title?: string
  artist?: string
  album?: string
  genre?: string
  year?: string
  track?: string
  comment?: string
}

export default function AdminUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [metadata, setMetadata] = useState<TrackMetadata>({})
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isExtractingMetadata, setIsExtractingMetadata] = useState(false)

  const extractMetadata = async (file: File) => {
    setIsExtractingMetadata(true)
    try {
      // Используем jsmediatags для извлечения метаданных
      const jsmediatags = await import('jsmediatags')
      
      return new Promise<TrackMetadata>((resolve) => {
        jsmediatags.default.read(file, {
          onSuccess: (tag: any) => {
            const extracted: TrackMetadata = {}
            
            // Извлекаем метаданные из разных тегов
            // Поддерживаем как ID3v2, так и ID3v1
            const tags = tag.tags || {}
            
            if (tags.title) extracted.title = tags.title
            if (tags.artist) extracted.artist = tags.artist
            if (tags.album) extracted.album = tags.album
            if (tags.genre) {
              // Genre может быть строкой или числом (ID3v1)
              extracted.genre = typeof tags.genre === 'string' ? tags.genre : String(tags.genre)
            }
            if (tags.year) extracted.year = String(tags.year)
            if (tags.track) extracted.track = String(tags.track)
            if (tags.comment) {
              // Comment может быть объектом или строкой
              extracted.comment = typeof tags.comment === 'string' ? tags.comment : tags.comment.text || ''
            }
            
            // Если не нашли название, используем имя файла
            if (!extracted.title) {
              const nameWithoutExt = file.name.replace(/\.mp3$/i, '')
              extracted.title = nameWithoutExt
            }
            
            resolve(extracted)
          },
          onError: (error: any) => {
            console.warn('Failed to extract metadata:', error)
            // Если не удалось извлечь, используем имя файла
            const nameWithoutExt = file.name.replace(/\.mp3$/i, '')
            resolve({ title: nameWithoutExt })
          }
        })
      })
    } catch (error) {
      console.warn('jsmediatags not available, using filename:', error)
      const nameWithoutExt = file.name.replace(/\.mp3$/i, '')
      return { title: nameWithoutExt }
    } finally {
      setIsExtractingMetadata(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      
      // Извлекаем метаданные из файла
      const extracted = await extractMetadata(selectedFile)
      setMetadata(extracted)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Защита от повторной отправки
    if (isProcessing) {
      return
    }
    
    if (!file) {
      setError('Please select a file')
      return
    }

    if (!metadata.title?.trim()) {
      setError('Название трека обязательно')
      return
    }

    setIsProcessing(true)
    setError(null)
    setSuccess(false)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', metadata.title || '')
      if (metadata.artist) formData.append('artist', metadata.artist)
      if (metadata.album) formData.append('album', metadata.album)
      if (metadata.genre) formData.append('genre', metadata.genre)
      if (metadata.year) formData.append('year', metadata.year)
      if (metadata.track) formData.append('track', metadata.track)
      if (metadata.comment) formData.append('comment', metadata.comment)
      
      // BPM и Offset всегда определяются автоматически
      formData.append('autoBpm', 'true')
      formData.append('autoOffset', 'true')

      const response = await fetch('/api/process-track', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process track')
      }

      setSuccess(true)
      
      // Перенаправляем на главную страницу через 2 секунды
      setTimeout(() => {
        router.push('/')
      }, 2000)
    } catch (err: any) {
      setError(err.message || 'An error occurred')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="min-h-screen p-8 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-gray-800">
          Загрузка и обработка трека
        </h1>

        <div className="bg-white rounded-lg shadow-md p-6">
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
              Трек успешно обработан и добавлен в базу данных!
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Файл */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                MP3 файл *
              </label>
              <input
                type="file"
                accept="audio/mpeg,audio/mp3,.mp3"
                onChange={handleFileChange}
                disabled={isProcessing}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-primary file:text-white
                  hover:file:bg-primary-dark
                  file:cursor-pointer
                  disabled:opacity-50"
                required
              />
              {file && (
                <div className="mt-2">
                  <p className="text-sm text-gray-600">
                    Выбран: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                  </p>
                  {isExtractingMetadata && (
                    <p className="mt-1 text-sm text-blue-600">
                      ⏳ Извлечение метаданных из файла...
                    </p>
                  )}
                  {!isExtractingMetadata && metadata.title && (
                    <p className="mt-1 text-sm text-green-600">
                      ✅ Метаданные извлечены и заполнены в форму ниже
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Метаданные в две колонки */}
            <div className="grid grid-cols-2 gap-4">
              {/* Название */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Название трека *
                </label>
                <input
                  type="text"
                  value={metadata.title || ''}
                  onChange={(e) => setMetadata({ ...metadata, title: e.target.value })}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                  required
                />
              </div>

              {/* Исполнитель */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Исполнитель
                </label>
                <input
                  type="text"
                  value={metadata.artist || ''}
                  onChange={(e) => setMetadata({ ...metadata, artist: e.target.value })}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                />
              </div>

              {/* Альбом */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Альбом
                </label>
                <input
                  type="text"
                  value={metadata.album || ''}
                  onChange={(e) => setMetadata({ ...metadata, album: e.target.value })}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                />
              </div>

              {/* Жанр */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Жанр
                </label>
                <input
                  type="text"
                  value={metadata.genre || ''}
                  onChange={(e) => setMetadata({ ...metadata, genre: e.target.value })}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                />
              </div>

              {/* Год */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Год
                </label>
                <input
                  type="text"
                  value={metadata.year || ''}
                  onChange={(e) => setMetadata({ ...metadata, year: e.target.value })}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                  placeholder="2024"
                />
              </div>

              {/* Номер трека */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Номер трека
                </label>
                <input
                  type="text"
                  value={metadata.track || ''}
                  onChange={(e) => setMetadata({ ...metadata, track: e.target.value })}
                  disabled={isProcessing}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                  placeholder="1"
                />
              </div>
            </div>

            {/* Комментарий (на всю ширину) */}
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Комментарий
              </label>
              <textarea
                value={metadata.comment || ''}
                onChange={(e) => setMetadata({ ...metadata, comment: e.target.value })}
                disabled={isProcessing}
                rows={3}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
                placeholder="Дополнительная информация о треке..."
              />
            </div>

            {/* Кнопка отправки */}
            <button
              type="submit"
              disabled={isProcessing || !file}
              className="w-full py-3 px-4 bg-primary text-white rounded-lg font-medium hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Обработка... (это может занять несколько минут)
                </span>
              ) : (
                'Загрузить и обработать'
              )}
            </button>
          </form>

          {/* Информация */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Требования:</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• На сервере должен быть установлен Python 3.8+ и FFmpeg</li>
              <li>• Для автоматического определения BPM и Offset: <code className="bg-blue-100 px-1 rounded">pip install madmom librosa soundfile</code></li>
              <li>• Обработка может занять несколько секунд в зависимости от размера файла</li>
              <li>• Максимальный размер файла: 100MB</li>
            </ul>
            <p className="text-xs text-blue-700 mt-2">
              💡 BPM и Offset определяются автоматически при загрузке трека.
            </p>
            <p className="text-xs text-blue-700 mt-2">
              📝 Примечание: Разложение трека на стемы (vocals, drums, bass, other) будет выполнено позже по запросу из плейлиста.
            </p>
            <p className="text-xs text-blue-700 mt-2">
              🎵 Метаданные (название, исполнитель, альбом и т.д.) автоматически извлекаются из файла, если они есть. Вы можете их дополнить или исправить.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

