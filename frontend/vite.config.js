import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
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

  const aliases = [{ find: '@', replacement: path.resolve(__dirname, 'src') }];
  if (useMock) {
    aliases.push({ find: '../api/client', replacement: path.resolve(__dirname, 'src/api/client.mock.js') });
  }

  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: aliases },
    server: {
      port: 5173,
      proxy: {
        // Strip /api like Module 9's nginx (proxy_pass http://backend:4000/): the
        // backend mounts /auth, /predict, ... at its root. Without the rewrite every
        // dev request reached the backend as /api/... and got 404.
        '/api': {
          target: 'http://127.0.0.1:4000',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  };
});
