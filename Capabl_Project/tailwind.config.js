/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--accent)',
          light: 'var(--accent-light)',
          dark: 'var(--accent-dark)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          light: 'var(--secondary-light)',
          dark: 'var(--secondary-dark)',
        },
        background: 'var(--bg)',
        surface: 'var(--surface)',
        'card-bg': 'var(--card-bg)',
        text: {
          main: 'var(--text-primary)',
          muted: 'var(--text-secondary)',
        },
        border: 'var(--border)',
        muted: 'var(--muted)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        'theme': 'var(--shadow)',
        'theme-lg': 'var(--shadow-lg)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}

