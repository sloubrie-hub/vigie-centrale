import { extractYoutubeVideoId } from "./archive-identity.ts";
import { publishAll, type CollectorTask } from "./collector-runner.ts";
import { requestJson, requestText, safeDiagnostic } from "./http-client.ts";
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

type YoutubeChannel = (typeof youtubeChannels)[number];
type HubVideo = { id: string; channel_id: string; title: string; published_at: string; expires_at: string; checked_in_run: 0 | 1 };
type HubBatch = { run_id: string | null; finished_at: string | null; items: HubVideo[] };

function hubEndpoint() {
  const origin = process.env.VIGIE_HUB_ORIGIN;
  if (!origin || !/^https:\/\/[a-z0-9.-]+\.chatgpt\.site\/?$/.test(origin)) return null;
  return new URL("/api/service/vigie-youtube", origin).href;
}

async function readHubYoutube(): Promise<HubBatch | null> {
  const endpoint = hubEndpoint();
  const sitesToken = process.env.VIGIE_HUB_SITES_TOKEN;
  const readProof = process.env.VIGIE_HUB_READ_PROOF;
  if (!endpoint || !sitesToken || !readProof || !/^[a-f0-9]{64}$/.test(readProof)) return null;
  try {
    const batch = await requestJson<HubBatch>(endpoint, {
      label: "Lot YouTube du Hub", redirect: "error", cache: "no-store", timeoutMs: 2500, maxRetries: 0, maxResponseBytes: 256 * 1024,
      headers: { Accept: "application/json", "OAI-Sites-Authorization": `Bearer ${sitesToken}`, "X-BSH-Vigie": readProof },
    });
    if (!batch || !Array.isArray(batch.items) || batch.items.length > 240 || batch.items.some((video) =>
      !video || !hearthstone.has(video.channel_id) || typeof video.id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(video.id) || typeof video.title !== "string" ||
      !Number.isFinite(Date.parse(video.published_at)) || !Number.isFinite(Date.parse(video.expires_at)) ||
      ![0, 1].includes(video.checked_in_run))) return null;
    return { ...batch, items: batch.items.filter(({ expires_at }) => Date.parse(expires_at) > Date.now()) };
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

export function createYoutubeTasks(sourceFor: (id: string) => SourceDefinition): CollectorTask[] {
  const reuse = process.env.VIGIE_HUB_REUSE === "true";
  let sharedBatch: Promise<HubBatch | null> | undefined;
  return youtubeChannels.map((channel) => ({
    source: sourceFor(channel.id),
    run: async () => {
      if (reuse && channel.theme === "Hearthstone") {
        const batch = await (sharedBatch ??= readHubYoutube());
        const videos = coveredVideos(batch, channel.channelId);
        if (batch && videos.length) {
          console.info(`YouTube ${channel.creator} : passage du Hub ${batch.run_id} réutilisé.`);
          return { items: [], itemsCollected: videos.length };
        }
      }
      return publishAll(await readYoutubeAtom(channel));
    },
  }));
}

export async function inspectHubYoutubeCoverage() {
  const observedAt = new Date().toISOString();
  const endpoint = hubEndpoint();
  if (!endpoint) return { observedAt, hub: "unconfigured", batch: null, channels: [] };
  const batch = await readHubYoutube();
  let probe = "authenticated";
  if (!batch) {
    try {
      const response = await fetch(endpoint, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(2500) });
      probe = `HTTP ${response.status}`;
      await response.body?.cancel();
    } catch {
      probe = "aucune réponse du Hub";
    }
  }
  const finishedAt = batch?.finished_at ? Date.parse(batch.finished_at) : NaN;
  const channels = await Promise.all([...hearthstone.values()].map(async (channel) => {
    const candidate = coveredVideos(batch, channel.channelId);
    try {
      const atom = await readYoutubeAtom(channel);
      const candidateIds = new Set(candidate.map(({ id }) => id));
      const atomIds = new Set(atom.map(({ url }) => extractYoutubeVideoId(url)));
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
    } catch (error) {
      return { source: channel.id, hubCount: candidate.length, atomCount: null, equivalent: null, error: safeDiagnostic(error) };
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
  if (process.env.VIGIE_HUB_REUSE !== "true" || (theme && theme !== "Hearthstone")) return archived;
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
