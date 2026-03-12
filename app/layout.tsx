import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/lib/theme'

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
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("bachata-theme");document.documentElement.setAttribute("data-theme",t||"purple-night")}catch(e){document.documentElement.setAttribute("data-theme","purple-night")}})()`,
          }}
        />
      </head>
      <body className={`${inter.className}`} suppressHydrationWarning>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}

