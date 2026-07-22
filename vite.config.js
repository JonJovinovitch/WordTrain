import { defineConfig } from 'vite'

export default defineConfig({
  // The game + SDK live in client/; the built site goes to public/,
  // which the Express server serves.
  root: 'client',
  base: './',
  server: {
    port: 5174,
    allowedHosts: true,
    // In local dev, hand API calls to the Express server on :3001
    proxy: { '/api': 'http://localhost:3001' }
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/discord.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
})
