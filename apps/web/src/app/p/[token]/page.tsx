import type { Metadata } from 'next';
import { ProposalView } from './proposal-view';

export const metadata: Metadata = { title: 'Proposal', robots: { index: false, follow: false } };

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { token } = await params;
  const { preview } = await searchParams;
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-background px-4 py-10">
      <ProposalView token={token} preview={preview === '1'} />
    </main>
  );
}
