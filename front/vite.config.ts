import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Как `vite --host`: слушаем все интерфейсы. На части Windows-сетапов иначе браузер
// не попадает в dev-сервер при открытии localhost (IPv4/IPv6).
// https://vite.dev/config/server-options.html#server-host
// https://vite.dev/guide/troubleshooting.html

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
