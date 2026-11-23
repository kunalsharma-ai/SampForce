import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WorkspaceHelpCenter } from './workspace-help';

export const metadata: Metadata = { title: 'Help center' };

export default function HelpPage() {
  return (
    <Suspense>
      <WorkspaceHelpCenter />
    </Suspense>
  );
}
