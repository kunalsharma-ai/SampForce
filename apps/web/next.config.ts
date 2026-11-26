import type { NextConfig } from 'next';
import path from 'node:path';
import pkg from './package.json';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

// The Content-Security-Policy (with a per-request script nonce) is set in src/middleware.ts.
const baseHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  // Browsers ignore this over plain HTTP, so it is safe for local runs; behind TLS it pins HTTPS for a year.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Linting runs once for the whole monorepo (pnpm lint), not again inside next build.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@dealflow/ui', '@dealflow/types', '@dealflow/help'],
  webpack: (webpackConfig) => {
    // The browser bundle compiles @dealflow/types (and @dealflow/help) from its ES module source rather than the CommonJS build the API
    // uses, so only what a page imports is shipped: the CommonJS build put the whole package (the server's text in
    // four languages, every schema) on every page, the sign-in page included.
    // @dealflow/help too, because its CommonJS build required the whole of @dealflow/types again.
    webpackConfig.resolve.alias = {
      ...webpackConfig.resolve.alias,
      '@dealflow/types$': path.resolve(__dirname, '../../packages/types/src/index.ts'),
      '@dealflow/help$': path.resolve(__dirname, '../../packages/help/src/index.ts'),
    };
    return webpackConfig;
  },
  // Sent with support queries, so the support team knows which build the person was on.
  env: { NEXT_PUBLIC_APP_VERSION: process.env.APP_VERSION ?? pkg.version },
  // The browser talks to the API through this origin, so auth cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      // Everything except hosted lead forms refuses to be framed.
      { source: '/((?!f/).*)', headers: [...baseHeaders, { key: 'X-Frame-Options', value: 'DENY' }] },
      // Hosted lead forms (/f/:token) are meant to be embedded on the customer's own site.
      { source: '/f/:path*', headers: baseHeaders },
    ];
  },
};

export default config;
