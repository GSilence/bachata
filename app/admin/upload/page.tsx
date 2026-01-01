'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [bpm, setBpm] = useState('120')
  const [offset, setOffset] = useState('0')
  const [autoBpm, setAutoBpm] = useState(true) // Автоматическое определение BPM
  const [autoOffset, setAutoOffset] = useState(true) // Автоматическое определение Offset
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    // Обновляем только если файл действительно выбран
    // Если пользователь закрыл диалог без выбора, files будет пустым
    if (selectedFile) {
      setFile(selectedFile)
      // Автоматически заполняем название из имени файла
      if (!title) {
        const nameWithoutExt = selectedFile.name.replace(/\.mp3$/i, '')
        setTitle(nameWithoutExt)
      }
    }
    // НЕ сбрасываем file, если selectedFile === undefined (пользователь закрыл диалог)
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

    if (!title.trim()) {
      setError('Title is required')
      return
    }

    setIsProcessing(true)
    setError(null)
    setSuccess(false)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('title', title)
      if (artist) formData.append('artist', artist)
      // Отправляем значения только если не автоматическое определение
      if (!autoBpm) {
        formData.append('bpm', bpm)
      }
      if (!autoOffset) {
        formData.append('offset', offset)
      }
      formData.append('autoBpm', autoBpm.toString())
      formData.append('autoOffset', autoOffset.toString())

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
            <div>
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
                <p className="mt-2 text-sm text-gray-600">
                  Выбран: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>

            {/* Название */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Название трека *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                disabled={isProcessing}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black"
              />
            </div>

            {/* BPM */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  BPM (ударов в минуту) *
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={autoBpm}
                    onChange={(e) => setAutoBpm(e.target.checked)}
                    disabled={isProcessing}
                    className="w-4 h-4 text-primary focus:ring-primary cursor-pointer"
                  />
                  <span>Определить автоматически</span>
                </label>
              </div>
              <input
                type="number"
                value={bpm}
                onChange={(e) => {
                  setBpm(e.target.value)
                  setAutoBpm(false) // Отключаем авто при ручном вводе
                }}
                disabled={isProcessing || autoBpm}
                min="60"
                max="200"
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black ${
                  autoBpm ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
                required={!autoBpm}
                placeholder={autoBpm ? 'Будет определено автоматически' : '120'}
              />
            </div>

            {/* Offset */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Offset (смещение первого бита в секундах) *
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={autoOffset}
                    onChange={(e) => setAutoOffset(e.target.checked)}
                    disabled={isProcessing}
                    className="w-4 h-4 text-primary focus:ring-primary cursor-pointer"
                  />
                  <span>Определить автоматически</span>
                </label>
              </div>
              <input
                type="number"
                step="0.1"
                value={offset}
                onChange={(e) => {
                  setOffset(e.target.value)
                  setAutoOffset(false) // Отключаем авто при ручном вводе
                }}
                disabled={isProcessing || autoOffset}
                min="0"
                max="10"
                className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-black ${
                  autoOffset ? 'bg-gray-100 cursor-not-allowed' : ''
                }`}
                required={!autoOffset}
                placeholder={autoOffset ? 'Будет определено автоматически' : '0.0'}
              />
              <p className="mt-1 text-xs text-gray-500">
                Время от начала трека до первого удара (например, 0.5)
              </p>
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
              <li>• Должен быть установлен Demucs: <code className="bg-blue-100 px-1 rounded">pip install demucs</code></li>
              <li>• Для автоматического определения BPM и Offset: <code className="bg-blue-100 px-1 rounded">pip install librosa soundfile</code></li>
              <li>• Обработка может занять несколько минут в зависимости от размера файла</li>
              <li>• Максимальный размер файла: 100MB</li>
            </ul>
            <p className="text-xs text-blue-700 mt-2">
              💡 Совет: Используйте опцию "Определить автоматически" для BPM и Offset - это сэкономит время и обеспечит точность!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

