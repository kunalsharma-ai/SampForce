import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * `npm run build`          → dist/ : normal hosting build (hashed JS, CSS, images and fonts as separate files).
 * `npm run build:preview`  → preview/index.html : one self-contained file (everything inlined) to open or email.
 *
 * Set VITE_BASE when the page is served from a sub-path of the Sampledge site, e.g. VITE_BASE=/products/sampforce/
 */
export default defineConfig(({ mode }) => {
  const single = mode === 'preview';
  return {
    base: single ? './' : (process.env.VITE_BASE ?? '/'),
    plugins: [react(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    build: single
      ? { outDir: 'preview', assetsInlineLimit: 100_000_000, cssCodeSplit: false, chunkSizeWarningLimit: 10_000 }
      : { outDir: 'dist', chunkSizeWarningLimit: 1_000 },
  };
});
