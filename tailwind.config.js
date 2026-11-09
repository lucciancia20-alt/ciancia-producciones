/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neon: {
          green: '#06b6d4',
          cyan: '#06b6d4',
          sky: '#0ea5e9',
          dark: '#0891b2',
        },
        dark: {
          900: '#0a0a0a',
          800: '#111111',
          700: '#1a1a1a',
          600: '#222222',
          500: '#2a2a2a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        neon: '0 0 10px #06b6d4, 0 0 20px #06b6d4, 0 0 40px rgba(6,182,212,0.35)',
        'neon-sm': '0 0 5px #06b6d4, 0 0 12px rgba(6,182,212,0.5)',
      },
      animation: {
        'pulse-neon': 'pulseNeon 2s ease-in-out infinite',
        'fade-in-up': 'fadeInUp 0.3s ease-out both',
      },
      keyframes: {
        fadeInUp: {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseNeon: {
          '0%, 100%': { boxShadow: '0 0 5px #06b6d4, 0 0 10px rgba(6,182,212,0.35)' },
          '50%': { boxShadow: '0 0 20px #06b6d4, 0 0 40px rgba(6,182,212,0.55)' },
        }
      }
    },
  },
  plugins: [],
}
