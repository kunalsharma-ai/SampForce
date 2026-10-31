import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'DealFlow', template: '%s · DealFlow' },
  description: 'DealFlow by Sampledge: the autonomous revenue intelligence platform.',
  applicationName: 'DealFlow',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#070B1A' },
    { media: '(prefers-color-scheme: light)', color: '#F7F9FD' },
  ],
};

// Applies the saved theme and motion preference before first paint to avoid a flash.
const preferenceBootstrap = `try{var p=JSON.parse(localStorage.getItem('dealflow:preferences')||'{}').state||{};var t=p.theme||'dark';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.motion=p.motion||'system';}catch(e){document.documentElement.classList.add('dark')}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next.js can put the CSP nonce on its scripts.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: preferenceBootstrap }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
