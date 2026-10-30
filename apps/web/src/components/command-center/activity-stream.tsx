'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import type { ActivityItem } from '@dealflow/types';
import { AnimatePresence, motion } from 'motion/react';
import { relativeTime } from '@/lib/format';

export function ActivityStream({ items }: { items: ActivityItem[] }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Activity stream</CardTitle>
        <CardDescription>Latest audited events in this workspace</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-border pl-4" aria-live="polite">
            <AnimatePresence initial={false}>
              {items.map((a) => (
                <motion.li key={a.id} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary ring-4 ring-background" aria-hidden />
                  <p className="text-sm">
                    <span className="font-medium">{a.actorName ?? 'System'}</span> {a.summary}
                  </p>
                  <time dateTime={a.createdAt} className="text-xs text-muted-foreground">
                    {relativeTime(a.createdAt)}
                  </time>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
