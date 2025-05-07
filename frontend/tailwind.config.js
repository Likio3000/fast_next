// frontend/tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}", // Good to have for future
  ],
  darkMode: 'media', // Respects system preference
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', '-apple-system', 'BlinkMacSystemFont', "Segoe UI", 'Roboto', "Helvetica Neue", 'Arial', "Noto Sans", 'sans-serif', "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', "Liberation Mono", "Courier New", 'monospace'],
      },
      colors: {
        // You can define brand colors here if needed
        // e.g., brand: { primary: '#yourcolor', secondary: '#yourcolor' }
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        dotFlashing: {
          '0%': { backgroundColor: 'currentColor', opacity: 0.5 },
          '50%': { backgroundColor: 'currentColor', opacity: 1 },
          '100%': { backgroundColor: 'currentColor', opacity: 0.5 },
        },
      },
      animation: {
        fadeInUp: 'fadeInUp 0.3s ease-out forwards',
        dotFlashing: 'dotFlashing 1s infinite linear alternate',
        'dotFlashing-delay1': 'dotFlashing 1s infinite linear alternate 0.2s',
        'dotFlashing-delay2': 'dotFlashing 1s infinite linear alternate 0.4s',
      },
    },
  },
  plugins: [],
};