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
          green: '#39FF14',
          dark: '#00cc00',
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
        neon: '0 0 10px #39FF14, 0 0 20px #39FF14, 0 0 40px rgba(57,255,20,0.3)',
        'neon-sm': '0 0 5px #39FF14, 0 0 10px rgba(57,255,20,0.5)',
      },
      animation: {
        'pulse-neon': 'pulseNeon 2s ease-in-out infinite',
      },
      keyframes: {
        pulseNeon: {
          '0%, 100%': { boxShadow: '0 0 5px #39FF14, 0 0 10px rgba(57,255,20,0.3)' },
          '50%': { boxShadow: '0 0 20px #39FF14, 0 0 40px rgba(57,255,20,0.5)' },
        }
      }
    },
  },
  plugins: [],
}
