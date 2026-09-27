import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Runs common's specs. The apps under apps/ are separate repositories with their own test setup.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['common/**/*.spec.ts'],
  },
});
