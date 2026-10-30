'use client';

import { Card, CardContent, Skeleton } from '@dealflow/ui';
import type { Permission } from '@dealflow/types';
import { useSession } from '@/lib/session';

/** Shows children only when the caller's role grants `permission`; otherwise says why. */
export function RequirePermission({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { data, isPending } = useSession();
  if (isPending) return <Skeleton className="h-40" />;
  if (!data?.permissions.includes(permission)) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Your role does not include access to this area ({permission}). Ask a workspace admin if you need it.
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
