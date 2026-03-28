import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const testApiBase =
  process.env.VITE_TEST_API_URL ?? 'http://127.0.0.1:3000';

export default mergeConfig(
  viteConfig,
  defineConfig({
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(testApiBase),
      'import.meta.env.VITE_WS_URL': JSON.stringify(''),
      'import.meta.env.DEV': JSON.stringify(false),
      'import.meta.env.MODE': JSON.stringify('test'),
      'import.meta.env.PROD': JSON.stringify(true),
    },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.integration.spec.ts'],
      testTimeout: 15_000,
    },
  }),
);
