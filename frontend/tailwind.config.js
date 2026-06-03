/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          500: '#3b6bff',
          600: '#2d57e6',
          700: '#1e3fb0',
        },
      },
    },
  },
  plugins: [],
}
