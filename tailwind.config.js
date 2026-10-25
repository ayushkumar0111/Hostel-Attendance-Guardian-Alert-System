/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ct: {
          navy: {
            DEFAULT: '#0a2540',
            dark: '#061727',
            light: '#133a63',
            50: '#f0f5fa',
            100: '#dde7f2',
            500: '#1a568c',
            800: '#0a2540',
            900: '#061727'
          },
          gold: {
            DEFAULT: '#d4af37',
            light: '#f5e7a9',
            dark: '#aa8c2c'
          }
        }
      }
    },
  },
  plugins: [],
}
