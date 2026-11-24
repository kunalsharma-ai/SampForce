'use client';

import { Button } from '@dealflow/ui';
import { PenSquare } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { HelpCenter } from '@/components/help/help-center';
import { useOperator } from '../operator-shell';

/** The Console's own Help Center: how to run SampForce for clients (ADR 0073), and the way into managing Help. */
export default function ConsoleHelpPage() {
  const me = useOperator();
  return (
    <Suspense>
      {me.data && (
        <div className="mx-auto mb-4 flex max-w-6xl justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href="/operator/help/manage" data-manage-help>
              <PenSquare aria-hidden />{' '}
              {me.data.role === 'ADMIN' ? 'Manage Help' : 'Help articles and feedback'}
            </Link>
          </Button>
        </div>
      )}
      <HelpCenter reader={{ audience: 'console' }} billingHref="/operator/plans" />
    </Suspense>
  );
}
