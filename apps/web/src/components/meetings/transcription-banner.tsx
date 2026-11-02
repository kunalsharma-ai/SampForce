'use client';

import { Badge } from '@dealflow/ui';
import type { TranscriptionStatus } from '@dealflow/types';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';

/** Deepgram state for one workspace: Pending Configuration, configured but not yet verified, or verified by a real transcription. */
export function TranscriptionBanner({ status, fallback = 'You can paste notes or a transcript in the meantime.' }: { status: TranscriptionStatus | undefined; fallback?: string }) {
  const t = useT();
  if (!status) return null;
  const body =
    status.state === 'pending_configuration' ? (
      <>
        <Badge tone="warning">{t('Pending Configuration')}</Badge>
        <span>
          {t("Recording transcription is not set up yet. An administrator needs to add a Deepgram API key to the server's secrets.")} {t.maybe(fallback)}
        </span>
      </>
    ) : status.state === 'configured' ? (
      <>
        <Badge tone="primary">{t('Configured, not yet verified')}</Badge>
        <span>{t('A transcription key is set. This shows as verified after the first recording is transcribed successfully in this workspace.')}</span>
      </>
    ) : (
      <>
        <Badge tone="success">{t('Verified')}</Badge>
        <span>
          {status.lastSuccessAt
            ? t('Recording transcription works here. Last successful transcription {when}.', { when: relativeTime(status.lastSuccessAt) })
            : t('Recording transcription works here.')}
        </span>
      </>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm" aria-label={t('Recording transcription status')}>
      {body}
    </div>
  );
}
