'use client';

import { Suspense } from 'react';
import { HelpCenter } from '@/components/help/help-center';

/** The Console's own Help Center: how to run SampForce for clients (ADR 0073). */
export default function ConsoleHelpPage() {
  return (
    <Suspense>
      <HelpCenter reader={{ audience: 'console' }} />
    </Suspense>
  );
}
