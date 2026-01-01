'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LibraryPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [bpm, setBpm] = useState('120')
  const [offset, setOffset] = useState('0')
  const [autoBpm, setAutoBpm] = useState(true)
  const [autoOffset, setAutoOffset] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    // Обновляем только если файл действительно выбран
    // Если пользователь закрыл диалог без выбора, files будет пустым
    if (selectedFile) {
      setFile(selectedFile)
      if (!title) {
        const nameWithoutExt = selectedFile.name.replace(/\.mp3$/i, '')
        setTitle(nameWithoutExt)
      }
    }
    // НЕ сбрасываем file, если selectedFile === undefined (пользователь закрыл диалог)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
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
    <div className="min-h-screen bg-gray-900 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white">Медиатека</h1>
          <Link
            href="/"
            className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            ← Назад
          </Link>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-6">Загрузить новый трек</h2>

          {error && (
            <div className="mb-4 p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-200">
              {error}
            </div>
          )}

          {success && (
            <div className="mb-4 p-4 bg-green-900/50 border border-green-700 rounded-lg text-green-200">
              Трек успешно обработан и добавлен в базу данных!
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Файл */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                MP3 файл *
              </label>
              <input
                type="file"
                accept="audio/mpeg,audio/mp3,.mp3"
                onChange={handleFileChange}
                disabled={isProcessing}
                className="block w-full text-sm text-gray-400
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-purple-600 file:text-white
                  hover:file:bg-purple-700
                  file:cursor-pointer
                  disabled:opacity-50"
                required
              />
              {file && (
                <p className="mt-2 text-sm text-gray-400">
                  Выбран: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>

            {/* Название */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Название трека *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isProcessing}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white"
                required
              />
            </div>

            {/* Исполнитель */}
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Исполнитель
              </label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                disabled={isProcessing}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white"
              />
            </div>

            {/* BPM */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-400">
                  BPM (ударов в минуту) *
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={autoBpm}
                    onChange={(e) => setAutoBpm(e.target.checked)}
                    disabled={isProcessing}
                    className="w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer bg-gray-700 border-gray-600"
                  />
                  <span>Определить автоматически</span>
                </label>
              </div>
              <input
                type="number"
                value={bpm}
                onChange={(e) => {
                  setBpm(e.target.value)
                  setAutoBpm(false)
                }}
                disabled={isProcessing || autoBpm}
                min="60"
                max="200"
                className={`w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white ${
                  autoBpm ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                required={!autoBpm}
                placeholder={autoBpm ? 'Будет определено автоматически' : '120'}
              />
            </div>

            {/* Offset */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-400">
                  Offset (смещение первого бита в секундах) *
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <input
                    type="checkbox"
                    checked={autoOffset}
                    onChange={(e) => setAutoOffset(e.target.checked)}
                    disabled={isProcessing}
                    className="w-4 h-4 text-purple-600 focus:ring-purple-600 cursor-pointer bg-gray-700 border-gray-600"
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
                  setAutoOffset(false)
                }}
                disabled={isProcessing || autoOffset}
                min="0"
                max="10"
                className={`w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-600 text-white ${
                  autoOffset ? 'opacity-50 cursor-not-allowed' : ''
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
              className="w-full py-3 px-4 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="mt-6 p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
            <p className="text-sm text-blue-200">
              💡 Используйте опцию "Определить автоматически" для BPM и Offset - это сэкономит время и обеспечит точность!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

