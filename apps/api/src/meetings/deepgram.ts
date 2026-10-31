import { Inject, Injectable } from '@nestjs/common';
import type { TranscriptSegment } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';

export class TranscriptionError extends Error {}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptSegment[];
  durationSeconds: number | null;
}

/**
 * Deepgram pre-recorded speech-to-text, with the customer's own DEEPGRAM_API_KEY, called only from the server.
 * The audio is streamed through and never stored. Speakers come back numbered (diarisation), not named.
 */
@Injectable()
export class DeepgramClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  get configured(): boolean {
    return !!this.env.DEEPGRAM_API_KEY;
  }

  get maxBytes(): number {
    return this.env.MEETING_UPLOAD_MAX_MB * 1024 * 1024;
  }

  async transcribe(audio: ReadableStream<Uint8Array> | Uint8Array, contentType: string): Promise<TranscriptionResult> {
    if (!this.env.DEEPGRAM_API_KEY) throw new TranscriptionError('Transcription is not configured.');
    const q = new URLSearchParams({ model: 'nova-3', smart_format: 'true', punctuate: 'true', diarize: 'true', utterances: 'true' });
    let res: Response;
    try {
      res = await fetch(`${this.env.DEEPGRAM_API_BASE_URL.replace(/\/+$/, '')}/v1/listen?${q}`, {
        method: 'POST',
        headers: { authorization: `Token ${this.env.DEEPGRAM_API_KEY}`, 'content-type': contentType },
        body: audio,
        // Streams the request body instead of buffering it.
        duplex: 'half',
        signal: AbortSignal.timeout(300_000),
      } as RequestInit);
    } catch (err) {
      throw new TranscriptionError(`Could not reach the transcription service: ${(err as Error).message}`);
    }
    const body = (await res.json().catch(() => null)) as DeepgramResponse | null;
    if (res.status === 401 || res.status === 403) throw new TranscriptionError('The transcription service rejected the API key. Check DEEPGRAM_API_KEY.');
    if (!res.ok || !body?.results) throw new TranscriptionError(`The transcription service answered ${res.status}${body?.err_msg ? `: ${body.err_msg}` : ''}.`);
    const segments: TranscriptSegment[] = (body.results.utterances ?? [])
      .filter((u) => u.transcript?.trim())
      .map((u) => ({ speaker: typeof u.speaker === 'number' ? u.speaker : null, start: u.start ?? 0, end: u.end ?? 0, text: u.transcript!.trim() }));
    const text = segments.length
      ? segments.map((s) => `${s.speaker === null ? '' : `Speaker ${s.speaker}: `}${s.text}`).join('\n')
      : (body.results.channels?.[0]?.alternatives?.[0]?.transcript ?? '').trim();
    if (!text) throw new TranscriptionError('No speech was found in the recording.');
    return { text: text.slice(0, 200_000), segments: segments.slice(0, 5000), durationSeconds: body.metadata?.duration ?? null };
  }
}

interface DeepgramResponse {
  err_msg?: string;
  metadata?: { duration?: number };
  results?: {
    channels?: { alternatives?: { transcript?: string }[] }[];
    utterances?: { start?: number; end?: number; speaker?: number; transcript?: string }[];
  };
}
