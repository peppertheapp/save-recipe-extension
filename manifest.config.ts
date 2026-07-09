import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Pepper Recipe Importer',
  version: pkg.version,
  description:
    'Save any recipe to your Pepper profile in one click. Pepper spots recipes on any site and saves them with one tap.',
  icons: {
    16: 'icons/pepper-green-16.png',
    32: 'icons/pepper-green-32.png',
    48: 'icons/pepper-green-48.png',
    128: 'icons/pepper-green-128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_icon: {
      16: 'icons/pepper-red-16.png',
      32: 'icons/pepper-red-32.png',
      48: 'icons/pepper-red-48.png',
      128: 'icons/pepper-red-128.png',
    },
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  permissions: ['storage', 'alarms'],
  host_permissions: ['https://api.peppertheapp.com/*'],
  web_accessible_resources: [
    {
      // Brand logo rendered by the content script's <img> inside page context.
      resources: ['icons/button-logo.png'],
      matches: ['<all_urls>'],
    },
  ],
});
