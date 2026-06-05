/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Brand: deep navy → electric blue → teal
        brand: {
          50: '#eef4ff',
          100: '#dbe7ff',
          200: '#b8ceff',
          300: '#8eaaff',
          400: '#5e7fff',
          500: '#3d5cff',
          600: '#2a40e8',
          700: '#1f30b8',
          800: '#1a2890',
          900: '#16226f',
          950: '#0e1648',
        },
        // Accent: warm coral for CTAs / highlights
        accent: {
          50: '#fff5f3',
          100: '#ffe6e0',
          300: '#ff9d8a',
          500: '#ff6b4a',
          600: '#ed4d2a',
          700: '#c5361b',
        },
        // Neutral: cool gray with subtle blue undertone
        ink: {
          50: '#f6f7fb',
          100: '#eceff7',
          200: '#d6dbe7',
          300: '#aab3c7',
          400: '#7c87a3',
          500: '#5a6585',
          600: '#404a6b',
          700: '#2c3552',
          800: '#1c2440',
          900: '#0e1430',
          950: '#070a1c',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'PingFang SC', 'Hiragino Sans GB',
          'Microsoft YaHei', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif',
        ],
        mono: [
          'JetBrains Mono', 'SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace',
        ],
      },
      boxShadow: {
        'soft': '0 1px 3px rgba(15, 20, 48, 0.04), 0 1px 2px rgba(15, 20, 48, 0.06)',
        'card': '0 4px 12px -2px rgba(15, 20, 48, 0.05), 0 2px 6px -1px rgba(15, 20, 48, 0.04)',
        'lift': '0 12px 32px -4px rgba(15, 20, 48, 0.10), 0 4px 12px -2px rgba(15, 20, 48, 0.06)',
        'glow': '0 0 0 4px rgba(61, 92, 255, 0.12)',
        'glow-accent': '0 0 0 4px rgba(255, 107, 74, 0.16)',
        'inner-soft': 'inset 0 1px 2px rgba(15, 20, 48, 0.06)',
      },
      backgroundImage: {
        'grid-light':
          "linear-gradient(rgba(15,20,48,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(15,20,48,0.04) 1px, transparent 1px)",
        'grid-dark':
          "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
        'mesh-hero':
          "radial-gradient(at 0% 0%, rgba(61,92,255,0.18) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(255,107,74,0.12) 0px, transparent 50%), radial-gradient(at 50% 100%, rgba(46,200,180,0.10) 0px, transparent 60%)",
        'mesh-hero-dark':
          "radial-gradient(at 0% 0%, rgba(61,92,255,0.32) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(255,107,74,0.18) 0px, transparent 50%), radial-gradient(at 50% 100%, rgba(46,200,180,0.18) 0px, transparent 60%)",
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: 0, transform: 'translateY(8px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        'fade-in-fast': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.6 },
        },
        'progress-stripes': {
          '0%': { backgroundPosition: '0 0' },
          '100%': { backgroundPosition: '32px 0' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'orbit': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in-fast': 'fade-in-fast 0.2s ease-out both',
        'shimmer': 'shimmer 2.4s linear infinite',
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'progress-stripes': 'progress-stripes 1s linear infinite',
        'float': 'float 4s ease-in-out infinite',
        'orbit': 'orbit 24s linear infinite',
      },
      borderRadius: {
        'xl2': '1.25rem',
      },
    },
  },
  plugins: [],
}
