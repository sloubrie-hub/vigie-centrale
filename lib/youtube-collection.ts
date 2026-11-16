import { verify as verifySignature } from "node:crypto";
import { getCache } from "@vercel/functions";
import { extractYoutubeVideoId } from "./archive-identity.ts";
import { publishAll, type CollectorTask } from "./collector-runner.ts";
import { requestText, safeDiagnostic } from "./http-client.ts";
import type { SourceDefinition, WatchItem } from "./watch-types.ts";
import { parseYoutubeFeed, youtubeWatchItem } from "./xml-feeds.ts";

export const youtubeChannels = [
  { id: "youtube-mathrais", creator: "Mathrais", channelId: "UCkhScOO1FChfqWbE8eR-ZSA", theme: "Hearthstone" as const },
  { id: "youtube-oliech", creator: "Oliech", channelId: "UCTdicWbtwYfLyZ7S1M9XuIQ", theme: "Hearthstone" as const },
  { id: "youtube-shadybunny", creator: "Shadybunny", channelId: "UCb1UDLJOk4n7qZa-Y0z7Yig", theme: "Hearthstone" as const },
  { id: "youtube-jeef", creator: "Jeef", channelId: "UCK3rJ7OXrXZIcnw-xYrSXOg", theme: "Hearthstone" as const },
  { id: "youtube-cliptis", creator: "Cliptis", channelId: "UCTNiHLvyyV1r4-OLb8xaL5g", theme: "Diablo 4" as const },
  { id: "youtube-rob2628", creator: "Rob2628", channelId: "UCLxdlfnTN3G02ekxOwoIzYw", theme: "Diablo 4" as const },
  { id: "youtube-wudijo", creator: "wudijo", channelId: "UCXApYvw59S9MypwdXb1Pe_w", theme: "Diablo 4" as const },
];

const hearthstone = new Map(youtubeChannels.filter(({ theme }) => theme === "Hearthstone").map((channel) => [channel.channelId, channel]));
const maxRunAge = 12 * 60 * 60 * 1000;
const cardsPerChannel = 2;
const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" });

type YoutubeChannel = (typeof youtubeChannels)[number];
type HubVideo = { id: string; channel_id: string; title: string; published_at: string; expires_at: string; checked_in_run: 0 | 1 };
type HubBatch = { run_id: string | null; finished_at: string | null; items: HubVideo[] };
type HubExport = HubBatch & { run_id: string; finished_at: string; delivery?: "nightly" };

function unpackHubBatch(batch: HubBatch | null) {
  if (!batch || !Array.isArray(batch.items) || batch.items.length > 240 || batch.items.some((video) =>
    !video || !hearthstone.has(video.channel_id) || typeof video.id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(video.id) || typeof video.title !== "string" ||
    !Number.isFinite(Date.parse(video.published_at)) || !Number.isFinite(Date.parse(video.expires_at)) ||
    ![0, 1].includes(video.checked_in_run))) return null;
  return { ...batch, items: batch.items.filter(({ expires_at }) => Date.parse(expires_at) > Date.now()) };
}

export function verifyHubYoutubeExport(envelope: unknown): HubExport | null {
  const publicKey = process.env.VIGIE_HUB_EXPORT_PUBLIC_KEY;
  if (!publicKey || !envelope || typeof envelope !== "object") return null;
  const { payload, signature } = envelope as { payload?: unknown; signature?: unknown };
  if (typeof payload !== "string" || Buffer.byteLength(payload) > 256 * 1024 ||
      typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return null;
  try {
    const key = { key: Buffer.from(publicKey, "base64"), format: "der" as const, type: "spki" as const };
    if (!verifySignature(null, Buffer.from(payload), key, Buffer.from(signature, "base64"))) return null;
    const lot = JSON.parse(payload) as HubBatch & { purpose?: string; delivery?: string };
    if (lot?.purpose !== "vigie-youtube-v1" || typeof lot.run_id !== "string" ||
      !/^[A-Za-z0-9-]{1,100}$/.test(lot.run_id) || typeof lot.finished_at !== "string") return null;
    const age = Date.now() - Date.parse(lot.finished_at);
    if (!(age >= 0 && age <= maxRunAge) || parisDay.format(new Date(lot.finished_at)) !== parisDay.format(new Date())) return null;
    const valid = unpackHubBatch(lot);
    return valid ? { items: valid.items, run_id: lot.run_id, finished_at: lot.finished_at,
      delivery: lot.delivery === "nightly" ? "nightly" : undefined } : null;
  } catch {
    return null;
  }
}

function hubCacheKey(date = new Date()) {
  return `vigie-hub-youtube-v1:${process.env.VERCEL_ENV ?? "local"}:${parisDay.format(date)}`;
}

export async function cacheHubYoutubeExport(envelope: unknown, requireNightly = false) {
  const lot = verifyHubYoutubeExport(envelope);
  if (!lot || (requireNightly && lot.delivery !== "nightly")) return null;
  const expiresAt = Date.parse(lot.finished_at) + maxRunAge;
  const ttl = Math.floor((expiresAt - Date.now()) / 1000);
  if (ttl <= 0) return null;
  const cache = getCache();
  const key = hubCacheKey(new Date(lot.finished_at));
  const current = verifyHubYoutubeExport(await cache.get(key));
  if (current && Date.parse(current.finished_at) >= Date.parse(lot.finished_at)) {
    return current.run_id === lot.run_id ? current : null;
  }
  await cache.set(key, envelope, { ttl });
  return lot;
}

export async function readHubYoutubeEnvelope(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 512 * 1024) return null;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 512 * 1024) return null;
    const body = request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")
      ? new URLSearchParams(text).get("export") : text;
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

function hubEndpoint() {
  const origin = process.env.VIGIE_HUB_ORIGIN;
  if (!origin || !/^https:\/\/[a-z0-9.-]+\.chatgpt\.site\/?$/.test(origin)) return null;
  return new URL("/api/service/vigie-youtube", origin).href;
}

async function readHubYoutube(): Promise<HubBatch | null> {
  if (!process.env.VIGIE_HUB_EXPORT_PUBLIC_KEY) return null;
  try {
    const lot = verifyHubYoutubeExport(await getCache().get(hubCacheKey()));
    return process.env.VERCEL_ENV === "production" && lot?.delivery !== "nightly" ? null : lot;
  } catch {
    return null;
  }
}

function coveredVideos(batch: HubBatch | null, channelId: string) {
  const finishedAt = Date.parse(batch?.finished_at ?? "");
  const age = Date.now() - finishedAt;
  if (!batch?.run_id || !/^[A-Za-z0-9-]{1,100}$/.test(batch.run_id) || !(age >= 0 && age <= maxRunAge)) return [];
  const videos = batch.items.filter((item) => item.channel_id === channelId).slice(0, cardsPerChannel);
  return videos.length === cardsPerChannel && new Set(videos.map(({ id }) => id)).size === cardsPerChannel &&
    videos.every((item) => item.checked_in_run === 1 && Date.parse(item.published_at) <= finishedAt) ? videos : [];
}

async function readYoutubeAtom(channel: YoutubeChannel) {
  const { text } = await requestText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`, {
    label: `YouTube ${channel.creator}`, headers: { "User-Agent": "Vigie-Centrale/1.0" },
  });
  return parseYoutubeFeed(text, channel.creator, channel.theme, cardsPerChannel);
}

function compareYoutubeCoverage(batch: HubBatch | null, channel: YoutubeChannel, atom: WatchItem[]) {
  const candidate = coveredVideos(batch, channel.channelId);
  const candidateIds = new Set(candidate.map(({ id }) => id));
  const atomIds = new Set(atom.map(({ url }) => extractYoutubeVideoId(url)));
  const finishedAt = batch?.finished_at ? Date.parse(batch.finished_at) : NaN;
  return {
    source: channel.id,
    hubCount: candidate.length,
    atomCount: atom.length,
    equivalent: batch && atom.length === cardsPerChannel
      ? candidateIds.size === cardsPerChannel && atomIds.size === cardsPerChannel &&
        [...atomIds].every((id) => id !== null && candidateIds.has(id))
      : null,
    publishedAfterHub: Number.isFinite(finishedAt)
      ? atom.filter(({ date }) => Date.parse(date) > finishedAt).length
      : null,
  };
}

export function createYoutubeTasks(sourceFor: (id: string) => SourceDefinition): CollectorTask[] {
  const reuse = process.env.VIGIE_HUB_REUSE === "true";
  const observe = process.env.VIGIE_HUB_OBSERVE === "true";
  let sharedBatch: Promise<HubBatch | null> | undefined;
  return youtubeChannels.map((channel) => ({
    source: sourceFor(channel.id),
    run: async () => {
      const readsHub = channel.theme === "Hearthstone" && (reuse || observe);
      const batch = readsHub ? await (sharedBatch ??= readHubYoutube()) : null;
      if (reuse && !observe && batch) {
        const videos = coveredVideos(batch, channel.channelId);
        if (videos.length) {
          console.info(`YouTube ${channel.creator} : passage du Hub ${batch.run_id} réutilisé.`);
          return { items: [], itemsCollected: videos.length };
        }
      }
      const items = await readYoutubeAtom(channel);
      if (observe && readsHub) {
        console.info(JSON.stringify({ event: "hub-youtube-coverage", runId: batch?.run_id ?? null,
          finishedAt: batch?.finished_at ?? null, ...compareYoutubeCoverage(batch, channel, items) }));
      }
      return publishAll(items);
    },
  }));
}

export async function inspectHubYoutubeCoverage() {
  const observedAt = new Date().toISOString();
  const endpoint = hubEndpoint();
  const batch = await readHubYoutube();
  let probe = "lot signé relu en cache";
  if (!batch && endpoint) {
    try {
      const response = await fetch(endpoint, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(2500) });
      probe = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch {
      probe = "aucune réponse du Hub";
    }
  } else if (!batch) {
    probe = "unconfigured";
  }
  const channels = await Promise.all([...hearthstone.values()].map(async (channel) => {
    try {
      return compareYoutubeCoverage(batch, channel, await readYoutubeAtom(channel));
    } catch (error) {
      return { source: channel.id, hubCount: coveredVideos(batch, channel.channelId).length,
        atomCount: null, equivalent: null, error: safeDiagnostic(error) };
    }
  }));
  return {
    observedAt,
    hub: probe,
    batch: batch ? { id: batch.run_id, finishedAt: batch.finished_at } : null,
    channels,
  };
}

export async function includeHubYoutube(archived: WatchItem[], limit: number, options: { theme?: string; query?: string; history?: boolean } = {}): Promise<WatchItem[]> {
  const { theme = "", query = "", history = false } = options;
  if (process.env.VIGIE_HUB_REUSE !== "true" || process.env.VIGIE_HUB_OBSERVE === "true" ||
      (theme && theme !== "Hearthstone")) return archived;
  const batch = await readHubYoutube();
  if (!batch) return archived;
  const terms = query.trim().toLowerCase();
  const known = new Set(archived.filter((item) => item.theme === "Hearthstone").map((item) => extractYoutubeVideoId(item.url)));
  const visible = history ? batch.items : [...hearthstone.keys()].flatMap((id) =>
    batch.items.filter((item) => item.channel_id === id).slice(0, cardsPerChannel));
  const extra: WatchItem[] = [];
  for (const video of visible) {
    if (known.has(video.id)) continue;
    const channel = hearthstone.get(video.channel_id)!;
    const item = youtubeWatchItem({ id: video.id, title: video.title, date: new Date(video.published_at).toISOString() }, channel.creator, channel.theme);
    if (terms && ![item.title, item.summary, item.source].some((value) => value.toLowerCase().includes(terms))) continue;
    known.add(video.id);
    extra.push(item);
  }
  return extra.length ? [...archived, ...extra].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, limit) : archived;
}
