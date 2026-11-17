import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { ChatPage } from './chat-screen';

export const metadata: Metadata = { title: 'Team chat' };

export default function TeamChatPage() {
  return (
    <div className="max-w-7xl">
      <PageHeader title="Team chat" description="Direct messages, channels such as Project updates, and the support line to SampForce super admins. Chat runs on your own SampForce server, so it also works on an office network without internet." />
      <Suspense>
        <ChatPage />
      </Suspense>
    </div>
  );
}
