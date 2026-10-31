'use client';

import { Badge } from '@dealflow/ui';
import type { TranscriptionStatus } from '@dealflow/types';
import { relativeTime } from '@/lib/format';

/** Deepgram state for one workspace: Pending Configuration, configured but not yet verified, or verified by a real transcription. */
export function TranscriptionBanner({ status, fallback = 'You can paste notes or a transcript in the meantime.' }: { status: TranscriptionStatus | undefined; fallback?: string }) {
  if (!status) return null;
  const body =
    status.state === 'pending_configuration' ? (
      <>
        <Badge tone="warning">Pending Configuration</Badge>
        <span>Recording transcription is not set up yet. An administrator needs to add a Deepgram API key to the server&apos;s secrets. {fallback}</span>
      </>
    ) : status.state === 'configured' ? (
      <>
        <Badge tone="primary">Configured, not yet verified</Badge>
        <span>A transcription key is set. This shows as verified after the first recording is transcribed successfully in this workspace.</span>
      </>
    ) : (
      <>
        <Badge tone="success">Verified</Badge>
        <span>Recording transcription works here. Last successful transcription {status.lastSuccessAt ? relativeTime(status.lastSuccessAt) : 'recently'}.</span>
      </>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm" aria-label="Recording transcription status">
      {body}
    </div>
  );
}
