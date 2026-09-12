import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Dev-only: proxy /api to the Module 2/6 backend so the frontend can call
// relative paths (see src/api/client.js) without CORS config.
//
// Set VITE_USE_MOCK=true (in .env, or inline on the command line) to swap
// every `../api/client` import for src/api/client.mock.js instead — lets you
// click through the whole UI with dummy data when the backend isn't running.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useMock = env.VITE_USE_MOCK === 'true';

  return {
    plugins: [react()],
    resolve: useMock
      ? { alias: [{ find: '../api/client', replacement: path.resolve(__dirname, 'src/api/client.mock.js') }] }
      : {},
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  };
});
