'use client';

import { PageHelp } from '@/components/page-help';
import { Tr } from '@/lib/i18n';

/**
 * Page title row. Title and description are translated when the catalogue has their English text as a phrase. The
 * "i" button next to the title explains the page (chosen from the route, see lib/help).
 */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Tr text={title} />
          </h1>
          <PageHelp />
        </div>
        {description && (
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Tr text={description} />
          </p>
        )}
      </div>
      {actions}
    </div>
  );
}
