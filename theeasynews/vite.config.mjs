import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { publicDefines } from './tooling/public-env.mjs';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: publicDefines(loadEnv(mode, process.cwd(), 'REACT_APP_')),
  build: { outDir: 'build' },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
    include: ['src/**/*.test.{js,jsx}'],
    maxWorkers: 2,
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
}));
