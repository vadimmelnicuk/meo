import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  base: './',
  build: {
    minify: 'esbuild',
    sourcemap: false,
    target: 'es2020',
    reportCompressedSize: false,
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'index[extname]'
      }
    }
  },
  esbuild: {
    drop: ['console', 'debugger']
  }
});
