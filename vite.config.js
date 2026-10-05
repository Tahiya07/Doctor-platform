import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the app from /Doctor-platform/,
  // while Vercel serves it from the domain root.
  base: process.env.VERCEL ? '/' : '/Doctor-platform/',
})
