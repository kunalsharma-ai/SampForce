import type { Metadata } from 'next';
import { AuthLanguage } from '@/components/auth-language';
import { VerifyCertificate } from '@/components/learning/verify-certificate';

export const metadata: Metadata = { title: 'Verify a certificate', robots: { index: false, follow: false } };

export default async function VerifyCertificatePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <main className="mx-auto min-h-screen max-w-xl space-y-4 bg-background px-4 py-12">
      <div className="flex justify-end">
        <AuthLanguage />
      </div>
      <VerifyCertificate code={decodeURIComponent(code)} />
    </main>
  );
}
