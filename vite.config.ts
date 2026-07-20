import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Standalone HTML pages (not declared as popup/options) must be listed
      // as build inputs or CRXJS copies them verbatim without compiling their
      // <script> — leaving a raw .ts reference that never runs in the extension.
      input: {
        onboarding: fileURLToPath(new URL('./src/onboarding/onboarding.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
