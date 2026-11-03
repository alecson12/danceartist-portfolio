import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pages from './vite-plugin-pages.js'

// Served from https://almarga.github.io/dance-portfolio/ — the subfolder is the base for build and preview, not the dev server.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/dance-portfolio/' : '/',
  plugins: [react(), tailwindcss(), pages()],
}))
