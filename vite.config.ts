import { cloudflare } from '@cloudflare/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { exhibitChecks, readWranglerConfig } from './scripts/exhibit-checks.ts';

const wrangler = readWranglerConfig();

export default defineConfig({
  plugins: [exhibitChecks(), svelte(), cloudflare()],
  define: {
    // QRコードと結果URLの正本（仕様書10.1節）。
    __PUBLIC_ORIGIN__: JSON.stringify(wrangler.vars.PUBLIC_ORIGIN),
  },
});
