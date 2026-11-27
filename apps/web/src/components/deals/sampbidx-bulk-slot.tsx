'use client';

import { SampbidxBulkButton } from '@/components/sampbidx/bulk-send';

/**
 * "Send to SampBidx" for the selected deals (ADR 0099), in the deals bulk bars (board and table). It opens the check
 * screen, then sends each deal with its company as the SampBidx client; hidden without SampBidx on the plan or the
 * rights to change deals.
 */
export function SampBidxBulkSlot({ dealIds, onDone }: { dealIds: string[]; onDone?: () => void }) {
  return <SampbidxBulkButton kind="DEALS" ids={dealIds} onDone={onDone} />;
}
