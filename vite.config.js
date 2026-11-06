import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: false,
    proxy: {
      '/api/suggest': {
        target: 'https://suggestqueries.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/suggest/, '/complete/search'),
      },
      '/api/ddg-suggest': {
        target: 'https://ac.duckduckgo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ddg-suggest/, '/ac/'),
      },
    },
  },
});
