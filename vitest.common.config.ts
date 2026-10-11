import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Worker and Blob tests need Node globals; UI/session tests need a document.
export default defineConfig({
  root,
  plugins: [vue()],
  resolve: {
    dedupe: ['vue', 'pinia'],
    alias: { '@common': `${root}common` },
  },
  test: {
    environment: 'node',
    include: ['common/**/*.spec.ts'],
    environmentMatchGlobs: [
      ['common/components/**', 'jsdom'],
      ['common/tests/useSolrSearch.spec.ts', 'jsdom'],
      ['common/tests/syncService.spec.ts', 'jsdom'],
      ['common/tests/setupAppDbSync.spec.ts', 'jsdom'],
      ['common/core/remoteApi.cache.spec.ts', 'jsdom'],
    ],
  },
});
