import { createHmac } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-DealFlow-Signature';

/** `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`; receivers should reject stale timestamps. */
export function signatureHeader(secret: string, body: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/** Delay before retry number `attempt` (1-based): 1 min, 5 min, 30 min, 2 h, 6 h, then 12 h. */
export function retryDelayMs(attempt: number): number {
  const minutes = [1, 5, 30, 120, 360, 720];
  return (minutes[Math.min(attempt, minutes.length) - 1] ?? 720) * 60_000;
}
