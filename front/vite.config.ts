import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Как `vite --host`: слушаем все интерфейсы. На части Windows-сетапов иначе браузер
// не попадает в dev-сервер при открытии localhost (IPv4/IPv6).
// https://vite.dev/config/server-options.html#server-host
// https://vite.dev/guide/troubleshooting.html

// Прокси на 127.0.0.1: на Windows `localhost` иногда уходит в ::1, а Nest слушает IPv4 — Vite отдаёт 502.
const backendOrigin = 'http://127.0.0.1:3000';

const devProxy = {
  '/api': {
    target: backendOrigin,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
  '/socket.io': {
    target: backendOrigin,
    ws: true,
  },
} as const;

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    proxy: { ...devProxy },
  },
  preview: {
    proxy: { ...devProxy },
  },
})
