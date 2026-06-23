import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Default public origin used for canonical/OG/sitemap when no build override
 *  is supplied. Override with the VITE_PUBLIC_URL env/ARG at build time. */
const DEFAULT_PUBLIC_URL = 'https://findthenumber.marticio.com';

/** Default GA4 measurement ID; override (or disable with '') via VITE_GA_ID. */
const DEFAULT_GA_ID = 'G-LPX9PZDF83';

/** Replace %VITE_PUBLIC_URL% / %VITE_GA_ID% in index.html with build-time
 *  values, falling back to the committed default origin (and no GA). Reads
 *  both .env files and process.env so Docker build ARGs flow through. */
function htmlEnv(mode: string, root: string): Plugin {
  const fileEnv = loadEnv(mode, root, '');
  const pick = (k: string) => process.env[k] ?? fileEnv[k] ?? '';
  const has = (k: string) => k in process.env || k in fileEnv;
  const publicUrl = (pick('VITE_PUBLIC_URL') || DEFAULT_PUBLIC_URL).replace(/\/+$/, '');
  // explicit VITE_GA_ID wins (set it to '' to disable analytics); else default
  const gaId = has('VITE_GA_ID') ? pick('VITE_GA_ID') : DEFAULT_GA_ID;
  return {
    name: 'html-env-defaults',
    // run before Vite's core HTML handling (which URL-decodes attributes)
    transformIndexHtml: {
      order: 'pre',
      handler(html: string) {
        return html
          .replaceAll('__PUBLIC_URL__', publicUrl)
          .replaceAll('__GA_ID__', gaId);
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), htmlEnv(mode, process.cwd())],
  server: {
    port: 5180,
    strictPort: true,
    host: true,
    proxy: {
      // mirror the production nginx: same-origin /ws -> signaling server
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
        changeOrigin: true,
      },
    },
  },
}));
