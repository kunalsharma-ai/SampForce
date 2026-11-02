import type { Metadata } from 'next';
import { AuthLanguage } from '@/components/auth-language';
import { ProposalView } from './proposal-view';

export const metadata: Metadata = { title: 'Proposal', robots: { index: false, follow: false } };

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string; payment?: string }>;
}) {
  const { token } = await params;
  const { preview, payment } = await searchParams;
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-4 bg-background px-4 py-10">
      <div className="flex justify-end">
        <AuthLanguage />
      </div>
      <ProposalView token={token} preview={preview === '1'} returnedFromPayment={payment === 'done'} />
    </main>
  );
}
