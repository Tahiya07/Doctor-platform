import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the app from /Doctor-platform/,
  // while Vercel serves it from the domain root.
  base: process.env.VERCEL ? '/' : '/Doctor-platform/',
  build: {
    // Vite 8's default Lightning CSS minifier can drop the standard
    // backdrop-filter declaration, breaking glass effects in Chromium.
    // Keep CSS unminified until the upstream minifier regression is resolved.
    cssMinify: false,
  },
})
