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

// Paints the last theme engine output (lib/appearance-engine.ts) before first paint, so a reload never flashes the
// wrong theme. Falls back to the older stored theme setting, then to the signature dark theme.
// Also sets <html lang dir> from the saved language (stores/regional.ts) so right-to-left pages never flash mirrored.
const preferenceBootstrap = `try{var g=(JSON.parse(localStorage.getItem('dealflow:regional')||'{}').state||{}).regional;if(g&&/^(en|es|fr|de|ar)$/.test(g.language)){document.documentElement.lang=g.language;document.documentElement.dir=g.language==='ar'?'rtl':'ltr';}}catch(e){}try{var r=document.documentElement,c=JSON.parse(localStorage.getItem('dealflow:appearance-paint')||'null');if(c){var d=c.mode==='dark'||(c.mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);r.classList.toggle('dark',d);var v=d?c.dark:c.light;for(var k in v)r.style.setProperty(k,v[k]);for(var a in c.attrs)r.dataset[a]=c.attrs[a];}else{var p=JSON.parse(localStorage.getItem('dealflow:preferences')||'{}').state||{};var t=(p.appearance&&p.appearance.mode)||p.theme||'dark';r.classList.toggle('dark',t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches));var m=(p.appearance&&p.appearance.motion)||p.motion||'balanced';r.dataset.motion=m==='reduced'?'minimal':m==='system'?'balanced':m;}}catch(e){document.documentElement.classList.add('dark')}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the request makes every page render per request, so Next.js can put the CSP nonce on its scripts.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" dir="ltr" className="dark" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: preferenceBootstrap }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
