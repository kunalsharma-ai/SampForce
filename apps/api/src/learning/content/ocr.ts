import { dirname, join } from 'node:path';
import { Logger } from '@nestjs/common';

/*
 * Text recognition for scanned PDFs and images (ADR 0097), with Tesseract running inside the server: nothing is sent
 * anywhere, and it works on an office network without internet (the English language data ships with SampForce).
 * One recogniser at a time is kept and closed after a minute without work. LEARNING_OCR=false switches it off.
 */

const log = new Logger('LearningOcr');
const IDLE_MS = 60_000;
const PER_IMAGE_MS = 90_000;

interface Worker {
  recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
}

let worker: Promise<Worker | null> | null = null;
let idle: NodeJS.Timeout | null = null;
let queue: Promise<unknown> = Promise.resolve();

function start(): Promise<Worker | null> {
  worker ??= (async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const T = require('tesseract.js') as { createWorker: (lang: string, oem: number, opts: Record<string, unknown>) => Promise<Worker> };
      const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0');
      return await T.createWorker('eng', 1, { langPath, cacheMethod: 'none', gzip: true, logger: () => undefined, errorHandler: () => undefined });
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'text recognition is not available');
      worker = null;
      return null;
    }
  })();
  return worker;
}

function scheduleStop(): void {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => {
    const w = worker;
    worker = null;
    void w?.then((x) => x?.terminate()).catch(() => undefined);
  }, IDLE_MS);
  idle.unref?.();
}

const enabled = () => process.env.LEARNING_OCR !== 'false';

/** Recognises the text of the images, in order. Null when recognition is switched off or cannot run here. */
export function recognise(images: Buffer[]): Promise<{ text: string; confidence: number } | null> {
  if (!enabled() || !images.length) return Promise.resolve(null);
  const run = queue.then(async () => {
    const w = await start();
    if (!w) return null;
    const texts: string[] = [];
    let confidence = 0;
    for (const image of images) {
      let timer: NodeJS.Timeout | undefined;
      try {
        const r = await Promise.race([w.recognize(image), new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), PER_IMAGE_MS)))]);
        texts.push(r.data.text.trim());
        confidence += r.data.confidence;
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : err }, 'text recognition failed for one image');
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    scheduleStop();
    if (!texts.length) return null;
    return { text: texts.map(unwrap).join('\n\n'), confidence: confidence / texts.length };
  });
  queue = run.catch(() => undefined);
  return run;
}

/** Recognised text keeps the scan's line breaks; joins them back into paragraphs. */
function unwrap(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/-\n(?=\p{Ll})/gu, '').replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Closes the recogniser (tests, shutdown). */
export async function stopRecogniser(): Promise<void> {
  if (idle) clearTimeout(idle);
  const w = worker;
  worker = null;
  await w?.then((x) => x?.terminate()).catch(() => undefined);
}
