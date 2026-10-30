import type { NextConfig } from 'next';

const apiUrl = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const baseHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Linting runs once for the whole monorepo (pnpm lint), not again inside next build.
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@dealflow/ui'],
  // The browser talks to the API through this origin, so auth cookies stay first-party.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }];
  },
  async headers() {
    return [
      // Everything except hosted lead forms refuses to be framed.
      { source: '/((?!f/).*)', headers: [...baseHeaders, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
      // Hosted lead forms (/f/:token) are meant to be embedded on the customer's own site.
      { source: '/f/:path*', headers: [...baseHeaders, { key: 'Content-Security-Policy', value: 'frame-ancestors *' }] },
    ];
  },
};

export default config;
