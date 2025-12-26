import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Bachata Beat Counter',
  description: 'Веб-приложение для танцоров бачаты с голосовым счетом ритма',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ru" suppressHydrationWarning className="dark">
      <body className={`${inter.className} bg-gray-900 text-white`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}

