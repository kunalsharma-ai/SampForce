import { parseVideoUrl, type VideoInfo } from '@dealflow/types';
import { BROWSER_USER_AGENT, siteFetcher, type SiteFetcher } from '../../crm/site-fetch';
import { captionsText, sentencesToParagraphs } from './extract';

/*
 * Video links (ADR 0097). When a manager pastes a link SampForce checks it is a video it can play (YouTube, Vimeo,
 * Loom, Wistia, Dailymotion or a direct video file), reads its title, preview image and length where the provider
 * shares them, and looks for captions. Questions are drafted only from captions SampForce actually read; when there
 * are none it says so and the manager can paste the transcript.
 */

export interface VideoLookup {
  info: VideoInfo;
  /** The captions' text, when they could be read. */
  captions: string | null;
}

const TIMEOUT_MS = 12_000;
const PAGE_MAX = 3_000_000;
const CAPTIONS_MAX = 4_000_000;

export function videoFetcher(fixtureUrl?: string): SiteFetcher {
  return siteFetcher({ userAgent: BROWSER_USER_AGENT, timeoutMs: TIMEOUT_MS, pageMaxBytes: PAGE_MAX, fixtureUrl });
}

const NO_CAPTIONS = (provider: string) => `${provider} did not share captions for this video with SampForce, so no questions can be drafted from it yet. Paste the transcript or your notes below, or write the questions yourself.`;

export async function lookUpVideo(raw: string, fetcher: SiteFetcher): Promise<VideoLookup | null> {
  const parsed = parseVideoUrl(raw);
  if (!parsed) return null;
  const base: VideoInfo = { ...parsed, title: null, thumbnailUrl: null, durationSeconds: null, author: null, captions: 'UNKNOWN', note: null };
  try {
    switch (parsed.provider) {
      case 'YOUTUBE':
        return await youtube(base, fetcher);
      case 'VIMEO':
        return await vimeo(base, fetcher);
      case 'LOOM':
        return await oembedOnly(base, fetcher, `https://www.loom.com/v1/oembed?url=${encodeURIComponent(parsed.url)}`, 'Loom');
      case 'WISTIA':
        return await oembedOnly(base, fetcher, `https://fast.wistia.com/oembed?url=${encodeURIComponent(parsed.url)}`, 'Wistia');
      case 'DAILYMOTION':
        return await dailymotion(base, fetcher);
      case 'FILE_LINK': {
        const file = decodeURIComponent(new URL(parsed.url).pathname.split('/').pop() ?? '');
        return { info: { ...base, title: file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || null, captions: 'NOT_AVAILABLE', note: 'A video file link has no captions SampForce can read. Upload a captions file or paste the transcript to draft questions from it.' }, captions: null };
      }
    }
  } catch {
    return { info: { ...base, note: 'SampForce could not reach the video provider just now. The video still plays; try reading its captions again later, or paste the transcript.' }, captions: null };
  }
}

interface OEmbed {
  title?: string;
  thumbnail_url?: string;
  author_name?: string;
  duration?: number;
}

async function oembed(fetcher: SiteFetcher, url: string): Promise<OEmbed | null> {
  const j = (await fetcher.json(url)) as OEmbed | null;
  return j && typeof j === 'object' ? j : null;
}

async function oembedOnly(base: VideoInfo, fetcher: SiteFetcher, url: string, provider: string): Promise<VideoLookup> {
  const o = await oembed(fetcher, url);
  return {
    info: {
      ...base,
      title: o?.title ?? null,
      thumbnailUrl: o?.thumbnail_url ?? null,
      author: o?.author_name ?? null,
      durationSeconds: typeof o?.duration === 'number' ? Math.round(o.duration) : null,
      captions: 'NOT_AVAILABLE',
      note: o ? NO_CAPTIONS(provider) : `SampForce could not read this ${provider} video’s details. Check the link is public. ${NO_CAPTIONS(provider)}`,
    },
    captions: null,
  };
}

/** The JSON object assigned after `marker` in a page's script, read by matching braces. */
export function jsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as unknown;
      } catch {
        return null;
      }
    }
  }
  return null;
}

interface YtTrack {
  baseUrl: string;
  languageCode?: string;
  kind?: string;
  name?: { simpleText?: string };
}

async function youtube(base: VideoInfo, fetcher: SiteFetcher): Promise<VideoLookup> {
  const id = base.videoId!;
  const page = await fetcher.page(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&bpctr=9999999999`);
  const player = page ? (jsonAfter(page.html, 'ytInitialPlayerResponse') as {
    videoDetails?: { title?: string; lengthSeconds?: string; author?: string; thumbnail?: { thumbnails?: { url: string; width: number }[] } };
    playabilityStatus?: { status?: string; reason?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: YtTrack[] } };
  } | null) : null;
  const o = player?.videoDetails ? null : await oembed(fetcher, `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`);
  const d = player?.videoDetails;
  const thumbs = d?.thumbnail?.thumbnails ?? [];
  const info: VideoInfo = {
    ...base,
    title: d?.title ?? o?.title ?? null,
    author: d?.author ?? o?.author_name ?? null,
    durationSeconds: d?.lengthSeconds ? Number(d.lengthSeconds) || null : null,
    thumbnailUrl: thumbs.sort((a, b) => b.width - a.width)[0]?.url?.split('?')[0] ?? o?.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
  if (!player && !o) return { info: { ...info, captions: 'UNKNOWN', note: 'SampForce could not read this YouTube video’s details. Check the link and that the video is public or unlisted. The video can still be added; paste a transcript to draft questions from it.' }, captions: null };
  const status = player?.playabilityStatus?.status;
  if (status && status !== 'OK') return { info: { ...info, captions: 'NOT_AVAILABLE', note: `YouTube says this video cannot be played here${player?.playabilityStatus?.reason ? ` (${player.playabilityStatus.reason})` : ''}. Check it is public or unlisted and allows embedding.` }, captions: null };
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  if (!tracks.length) return { info: { ...info, captions: 'NOT_AVAILABLE', note: 'This YouTube video has no captions, so no questions can be drafted from it yet. Paste the transcript or your notes below, or write the questions yourself.' }, captions: null };
  const english = (t: YtTrack) => (t.languageCode ?? '').startsWith('en');
  const ordered = [...tracks.filter((t) => english(t) && t.kind !== 'asr'), ...tracks.filter((t) => english(t) && t.kind === 'asr'), ...tracks.filter((t) => !english(t) && t.kind !== 'asr'), ...tracks.filter((t) => !english(t) && t.kind === 'asr')];
  for (const t of ordered.slice(0, 3)) {
    const text = await youtubeTrack(fetcher, t.baseUrl);
    if (text) {
      const auto = t.kind === 'asr';
      const lang = t.name?.simpleText ?? t.languageCode ?? '';
      return { info: { ...info, captions: 'AVAILABLE', note: `Read the video’s ${auto ? 'automatic ' : ''}captions${lang ? ` (${lang})` : ''}.${auto ? ' Automatic captions can mishear words, so check drafted questions.' : ''}` }, captions: text };
    }
  }
  return { info: { ...info, captions: 'NOT_AVAILABLE', note: NO_CAPTIONS('YouTube') }, captions: null };
}

async function youtubeTrack(fetcher: SiteFetcher, baseUrl: string): Promise<string | null> {
  const url = baseUrl.startsWith('http') ? baseUrl : `https://www.youtube.com${baseUrl}`;
  const json = (await fetcher.json(`${url}${url.includes('?') ? '&' : '?'}fmt=json3`)) as { events?: { segs?: { utf8?: string }[] }[] } | null;
  if (json?.events?.length) {
    const words = json.events.flatMap((e) => (e.segs ?? []).map((s) => s.utf8 ?? '')).join('').replace(/\n/g, ' ');
    if (words.trim().length > 40) return sentencesToParagraphs(words);
  }
  const xml = await fetcher.file(url, 'text/xml,application/xml,*/*', CAPTIONS_MAX);
  if (xml?.length) {
    const s = xml.toString('utf8');
    const words = [...s.matchAll(/<(?:text|p)[^>]*>([\s\S]*?)<\/(?:text|p)>/g)].map((m) => decodeEntities(m[1]!.replace(/<[^>]+>/g, ''))).join(' ');
    if (words.trim().length > 40) return sentencesToParagraphs(words);
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

async function vimeo(base: VideoInfo, fetcher: SiteFetcher): Promise<VideoLookup> {
  const o = await oembed(fetcher, `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(base.url)}`);
  const info: VideoInfo = {
    ...base,
    title: o?.title ?? null,
    thumbnailUrl: o?.thumbnail_url ?? null,
    author: o?.author_name ?? null,
    durationSeconds: typeof o?.duration === 'number' ? Math.round(o.duration) : null,
  };
  const config = (await fetcher.json(`https://player.vimeo.com/video/${base.videoId}/config`)) as { request?: { text_tracks?: { url: string; lang?: string; label?: string; kind?: string }[] } } | null;
  const tracks = config?.request?.text_tracks ?? [];
  if (!o && !config) return { info: { ...info, captions: 'UNKNOWN', note: 'SampForce could not read this Vimeo video’s details. Check the link and that the video allows embedding. Paste a transcript to draft questions from it.' }, captions: null };
  const ordered = [...tracks.filter((t) => (t.lang ?? '').startsWith('en')), ...tracks.filter((t) => !(t.lang ?? '').startsWith('en'))];
  for (const t of ordered.slice(0, 3)) {
    const vtt = await fetcher.file(new URL(t.url, 'https://player.vimeo.com').toString(), 'text/vtt,*/*', CAPTIONS_MAX);
    const text = vtt ? captionsText(vtt.toString('utf8')) : '';
    if (text.length > 40) return { info: { ...info, captions: 'AVAILABLE', note: `Read the video’s captions${t.label ? ` (${t.label})` : ''}.` }, captions: text };
  }
  return { info: { ...info, captions: 'NOT_AVAILABLE', note: tracks.length ? NO_CAPTIONS('Vimeo') : 'This Vimeo video has no captions, so no questions can be drafted from it yet. Paste the transcript or your notes below, or write the questions yourself.' }, captions: null };
}

async function dailymotion(base: VideoInfo, fetcher: SiteFetcher): Promise<VideoLookup> {
  const o = await oembed(fetcher, `https://www.dailymotion.com/services/oembed?url=${encodeURIComponent(base.url)}`);
  const info: VideoInfo = { ...base, title: o?.title ?? null, thumbnailUrl: o?.thumbnail_url ?? null, author: o?.author_name ?? null, durationSeconds: typeof o?.duration === 'number' ? Math.round(o.duration) : null };
  const subs = (await fetcher.json(`https://api.dailymotion.com/video/${base.videoId}/subtitles?fields=language,url`)) as { list?: { language?: string; url?: string }[] } | null;
  const list = (subs?.list ?? []).filter((s) => s.url);
  const ordered = [...list.filter((s) => (s.language ?? '').startsWith('en')), ...list.filter((s) => !(s.language ?? '').startsWith('en'))];
  for (const s of ordered.slice(0, 2)) {
    const file = await fetcher.file(s.url!, 'text/vtt,application/x-subrip,*/*', CAPTIONS_MAX);
    const text = file ? captionsText(file.toString('utf8')) : '';
    if (text.length > 40) return { info: { ...info, captions: 'AVAILABLE', note: 'Read the video’s captions.' }, captions: text };
  }
  return { info: { ...info, captions: 'NOT_AVAILABLE', note: NO_CAPTIONS('Dailymotion') }, captions: null };
}
