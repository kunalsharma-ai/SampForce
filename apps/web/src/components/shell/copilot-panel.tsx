'use client';

import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { Bot, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

const EXAMPLES = [
  'Show me deals likely to close this month.',
  'Which customers have stopped responding?',
  'Find duplicate customer records.',
  'Compare this month’s sales with last month.',
];

/**
 * Copilot entry point. The AI gateway ships in Phase 4; until then this panel explains what
 * the Copilot will do and how approvals work, rather than pretending to answer.
 */
export function CopilotPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="flex flex-col gap-5 p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-accent/15 text-accent">
            <Bot className="size-5" aria-hidden />
          </span>
          <div>
            <DialogTitle className="text-lg font-semibold">DealFlow Copilot</DialogTitle>
            <Badge tone="accent">Arrives in Phase 4</Badge>
          </div>
        </div>
        <DialogDescription className="text-sm text-muted-foreground">
          Copilot will turn plain-language requests into actions you are allowed to take. Read-only answers run
          immediately; anything that sends messages, changes prices or exports data waits for your approval.
        </DialogDescription>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">You will be able to ask</p>
          <ul className="space-y-2">
            {EXAMPLES.map((e) => (
              <li key={e} className="rounded-md border border-border bg-surface-raised/60 px-3 py-2 text-sm">
                “{e}”
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-3 rounded-md border border-border p-3 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <p className="text-muted-foreground">
            Every AI action is permission-checked, logged in the audit trail and can be disabled by an administrator.
          </p>
        </div>
        <Button asChild variant="outline" className="mt-auto" onClick={() => onOpenChange(false)}>
          <Link href="/app/agents">See the AI Agents roadmap</Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
