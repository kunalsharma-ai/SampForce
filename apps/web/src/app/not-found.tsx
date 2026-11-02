'use client';

import Link from 'next/link';
import { Button } from '@dealflow/ui';
import { useT } from '@/lib/i18n';

export default function NotFound() {
  const t = useT();
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div className="space-y-4">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="text-2xl font-semibold">{t('This page does not exist')}</h1>
        <Button asChild>
          <Link href="/app">{t('Back to the Command Center')}</Link>
        </Button>
      </div>
    </main>
  );
}
