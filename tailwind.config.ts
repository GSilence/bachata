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
      screens: {
        'sidebar': '1300px',  // full sidebar breakpoint
      },
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
        // Theme-aware colors via CSS variables
        theme: {
          bg: 'rgb(var(--bg-primary) / <alpha-value>)',
          'bg-secondary': 'rgb(var(--bg-secondary) / <alpha-value>)',
          'bg-tertiary': 'rgb(var(--bg-tertiary) / <alpha-value>)',
          'bg-elevated': 'rgb(var(--bg-elevated) / <alpha-value>)',
          surface: 'rgb(var(--surface-hover) / <alpha-value>)',
          'surface-active': 'rgb(var(--surface-active) / <alpha-value>)',
          border: 'rgb(var(--border-primary) / <alpha-value>)',
          'border-secondary': 'rgb(var(--border-secondary) / <alpha-value>)',
          text: 'rgb(var(--text-primary) / <alpha-value>)',
          'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
          'text-tertiary': 'rgb(var(--text-tertiary) / <alpha-value>)',
          'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',
          accent: 'rgb(var(--accent) / <alpha-value>)',
          'accent-light': 'rgb(var(--accent-light) / <alpha-value>)',
          'accent-dark': 'rgb(var(--accent-dark) / <alpha-value>)',
          'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
export default config
