import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * With VITE_DATA_SOURCE=http, requests to /api go to the backend (VITE_API_PROXY_TARGET, default
 * http://localhost:3000), so the browser sees one origin and the session cookie stays first-party.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // xfwd: pass the browser's host on as X-Forwarded-Host, so the API's same-origin check sees it.
  const proxy = { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: true, xfwd: true } };
  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  };
});
