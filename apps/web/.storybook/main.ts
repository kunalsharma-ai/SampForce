import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import react from '@vitejs/plugin-react';

/**
 * The DealFlow component catalogue: the design system primitives (packages/ui), the form library and other shared
 * components, rendered with the real theme engine, in every theme, light or dark, and left-to-right or right-to-left.
 */
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: {} },
  stories: ['../src/stories/**/*.mdx', '../src/stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  core: { disableTelemetry: true },
  typescript: { reactDocgen: 'react-docgen-typescript' },
  viteFinal: async (cfg) => {
    cfg.plugins = [...(cfg.plugins ?? []), react()];
    cfg.resolve = {
      ...cfg.resolve,
      alias: {
        ...(cfg.resolve?.alias as Record<string, string> | undefined),
        '@': fileURLToPath(new URL('../src', import.meta.url)),
        // The shared types package ships CommonJS for the API; Vite reads its TypeScript source directly instead.
        '@dealflow/types': fileURLToPath(new URL('../../../packages/types/src/index.ts', import.meta.url)),
      },
    };
    return cfg;
  },
};

export default config;
