import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3b82f6',
          dark: '#2563eb',
        },
        dark: {
          bg: '#111827', // gray-900
          surface: '#1f2937', // gray-800
          border: '#374151', // gray-700
        },
        purple: {
          dark: '#4338ca', // purple-800
        },
      },
    },
  },
  plugins: [],
}
export default config

