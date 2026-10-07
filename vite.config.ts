import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: true
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-nostr': ['nostr-tools'],
          'vendor-audio': ['@audio/decode-eac3']
        }
      }
    }
  }
});
