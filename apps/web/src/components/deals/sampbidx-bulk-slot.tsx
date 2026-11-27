'use client';

/**
 * Where the bulk "Send to SampBidx" action plugs into the deals bulk bar (Deals redesign, ADR 0096). The SampBidx
 * bulk transfer work fills this in with its button and review dialog; it fetches its own data from the ids. Until
 * then it renders nothing, so the bar never shows a button that does not work.
 */
export function SampBidxBulkSlot(_props: { dealIds: string[]; onDone: () => void }): React.ReactNode {
  return null;
}
