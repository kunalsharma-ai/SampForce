import { Tr } from '@/lib/i18n';

/** Page title row. Title and description are translated when the catalogue has their English text as a phrase. */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          <Tr text={title} />
        </h1>
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
