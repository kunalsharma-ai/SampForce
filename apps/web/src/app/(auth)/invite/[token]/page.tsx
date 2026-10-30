import type { Metadata } from 'next';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: 'Join a workspace', robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  return <AcceptInvitation token={(await params).token} />;
}
