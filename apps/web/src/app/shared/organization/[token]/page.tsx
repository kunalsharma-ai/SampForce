import type { Metadata } from 'next';
import { AuthLanguage } from '@/components/auth-language';
import { SharedOrganizationView } from './shared-view';

export const metadata: Metadata = { title: 'Company profile', robots: { index: false, follow: false } };

/** What a client sees on a My Organization share link (ADR 0100). No sign-in; the link itself is the key. */
export default async function SharedOrganizationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
        <div className="flex justify-end">
          <AuthLanguage />
        </div>
        <SharedOrganizationView token={token} />
      </div>
    </main>
  );
}
