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
      '/api/crx': {
        target: 'https://clients2.google.com',
        changeOrigin: true,
        followRedirects: true,
        rewrite: (path) => {
          const urlObj = new URL(path, 'http://localhost');
          const id = (urlObj.searchParams.get('id') || '').replace(/[^a-p]/g, '').slice(0, 32);
          return `/service/update2/crx?response=redirect&prodversion=122.0.0.0&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
        },
      },
    },
  },
});
