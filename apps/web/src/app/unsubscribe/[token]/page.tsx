import type { Metadata } from 'next';
import { Unsubscribe } from './unsubscribe';

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-start justify-center bg-background px-4 py-16">
      <Unsubscribe token={token} />
    </main>
  );
}
