'use client';

import { Button } from '@dealflow/ui';
import { Settings2 } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { JourneyBoardView } from '@/components/crm/journey';
import { PageHeader } from '@/components/page-header';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** The Pipeline page (redesign R5, ADR 0085): every company in its journey stage. Deal pipeline settings live in Settings. */
export function PipelineJourneyPage() {
  const t = useT();
  const canConfigure = useCan('pipelines:manage');
  return (
    <div className="min-w-0">
      <PageHeader
        title="Pipeline"
        description="Every company in its journey: from the first email through follow-ups, discussion, RFQs and negotiation to won or lost. Open a card to see its journey."
        actions={
          canConfigure ? (
            <Button asChild size="sm" variant="outline">
              <Link href="/app/settings/pipelines">
                <Settings2 aria-hidden className="size-4" /> {t('Deal pipeline settings')}
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Suspense>
        <JourneyBoardView />
      </Suspense>
    </div>
  );
}
