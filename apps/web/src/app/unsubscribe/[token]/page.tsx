import type { Metadata } from 'next';
import { AuthLanguage } from '@/components/auth-language';
import { Unsubscribe } from './unsubscribe';

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-4 bg-background px-4 py-16">
      <div className="flex justify-end">
        <AuthLanguage />
      </div>
      <Unsubscribe token={token} />
    </main>
  );
}
