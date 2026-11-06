import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Two outputs from one source:
//   npm run build             -> dist/              normal static site (hashed JS/CSS, images in /media)
//   npm run build:standalone  -> dist-standalone/   one self-contained HTML file (images and fonts inlined)
//
// BASE_PATH lets the page live under a sub-path of the main Sampledge site, e.g.
//   BASE_PATH=/products/sampforce/ npm run build
export default defineConfig(({ mode }) => {
  const standalone = mode === 'standalone';
  return {
    base: standalone ? './' : process.env.BASE_PATH || '/',
    plugins: [react(), ...(standalone ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    define: {
      __STANDALONE__: JSON.stringify(standalone),
    },
    build: {
      outDir: standalone ? 'dist-standalone' : 'dist',
      emptyOutDir: true,
      // Inline every asset in the standalone build; keep the normal build cacheable.
      assetsInlineLimit: standalone ? 100_000_000 : 4096,
      cssCodeSplit: !standalone,
      chunkSizeWarningLimit: 1200,
      rollupOptions: standalone
        ? {}
        : {
            output: {
              manualChunks(id) {
                if (id.includes('node_modules/three')) return 'three';
                if (id.includes('node_modules/framer-motion') || id.includes('node_modules/motion-')) return 'motion';
                return undefined;
              },
            },
          },
    },
  };
});
