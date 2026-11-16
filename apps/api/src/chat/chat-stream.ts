import type { Request, Response } from 'express';
import type { ChatStreamEvent } from '@dealflow/types';
import type { ChatBus, ChatListener } from './chat-bus';

/** A heartbeat keeps proxies (the office gateway, nginx) from closing an idle stream. */
const HEARTBEAT_MS = 20_000;
/**
 * A stream is closed after a few minutes and the browser reconnects at once. Reconnecting checks the session again,
 * so someone who signed out or was removed from the workspace stops receiving events.
 */
const MAX_STREAM_MS = Number(process.env.CHAT_STREAM_MAX_MS ?? 5 * 60_000);

/**
 * Opens a Server-Sent Events stream on the response: plain HTTP from the SampForce server, so it works through the
 * same gateway as the rest of the app and needs no internet. Each event names what changed; the browser re-reads it.
 */
export function openChatStream(bus: ChatBus, req: Request, res: Response, listener: { realm: 'user'; tenantId: string; userId: string } | { realm: 'operator'; operatorId: string }): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // nginx: pass events through as they are written.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const write = (e: ChatStreamEvent) => {
    res.write(`event: chat\ndata: ${JSON.stringify(e)}\n\n`);
  };
  res.write('retry: 3000\n\n');
  write({ type: 'ready' });
  const unsubscribe = bus.subscribe({ ...listener, send: write } as ChatListener);
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const end = setTimeout(() => res.end(), MAX_STREAM_MS);
  beat.unref();
  end.unref();
  const close = () => {
    clearInterval(beat);
    clearTimeout(end);
    unsubscribe();
  };
  req.on('close', close);
  res.on('close', close);
}
