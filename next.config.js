/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
}

// Отключаем trace файл для избежания ошибок EPERM на Windows
// Это должно быть установлено до загрузки Next.js
if (typeof process !== 'undefined') {
  process.env.NEXT_TRACE = '0'
}

module.exports = nextConfig

