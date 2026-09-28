import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// build.outDir 指向仓库根 public/, 后端 express.static(public) 直接 serve 新前端
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          codemirror: [
            '@uiw/react-codemirror',
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/lang-javascript',
            '@codemirror/lang-json',
          ],
        },
      },
    },
  },
})
