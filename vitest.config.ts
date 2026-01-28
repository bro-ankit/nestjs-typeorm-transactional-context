import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    hookTimeout: 60000,
    testTimeout: 60000,
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
    }),
  ],
});
