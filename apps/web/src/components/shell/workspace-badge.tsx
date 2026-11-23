'use client';

import { WORKSPACE_LEVEL_LABEL, type WorkspaceLevel } from '@dealflow/types';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Each level's colour in the header, so it is clear at a glance which workspace is open (ADR 0071). */
const DOT: Record<WorkspaceLevel, string> = {
  SUPER: 'bg-[hsl(262_83%_58%)]',
  MANAGER: 'bg-[hsl(199_89%_48%)]',
  EXECUTIVE: 'bg-[hsl(152_69%_40%)]',
};

/** The active workspace and its designation, always visible in the header. */
export function WorkspaceBadge() {
  const t = useT();
  const { data } = useSession();
  if (!data?.workspace) return null;
  const { level, designation, name } = data.workspace;
  return (
    <div
      className="hidden min-w-0 items-center gap-2 rounded-full border border-border bg-surface/60 py-1 pe-3 ps-2 text-xs xl:flex"
      data-workspace-level={level}
      title={name}
    >
      <span className={`size-2.5 shrink-0 rounded-full ${DOT[level]}`} aria-hidden />
      <span className="truncate font-semibold text-foreground">{t.maybe(WORKSPACE_LEVEL_LABEL[level])}</span>
      <span className="text-muted-foreground" aria-hidden>
        ·
      </span>
      <span className="truncate text-foreground">{t.maybe(designation)}</span>
    </div>
  );
}

/** The same in the account menu: name of the workspace, its level, designation and organisation. */
export function WorkspaceIdentityBlock() {
  const t = useT();
  const { data } = useSession();
  if (!data?.workspace) return null;
  const { level, designation, name } = data.workspace;
  return (
    <div className="px-2 py-2 text-xs" data-workspace-identity={level}>
      <p className="font-medium text-muted-foreground">{t('Active workspace')}</p>
      <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className={`size-2.5 shrink-0 rounded-full ${DOT[level]}`} aria-hidden />
        {t.maybe(WORKSPACE_LEVEL_LABEL[level])}
      </p>
      <p className="text-foreground">{t.maybe(designation)}</p>
      {level !== 'SUPER' && <p className="truncate text-muted-foreground">{name}</p>}
      <p className="truncate text-muted-foreground">{t('Organisation: {name}', { name: data.tenant.name })}</p>
    </div>
  );
}
