// frontend/postcss.config.mjs
import autoprefixer from 'autoprefixer';

export default {
  plugins: {
    '@tailwindcss/postcss': {}, // Tailwind v4’s PostCSS plugin
    autoprefixer: {},           // Next.js adds this by default — re‑add it manually
  },
};
