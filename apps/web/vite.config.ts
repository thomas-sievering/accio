import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.ACCIO_PORT ?? 47321);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5317,
    proxy: { '/ws': { target: `ws://127.0.0.1:${serverPort}`, ws: true } },
  },
});
