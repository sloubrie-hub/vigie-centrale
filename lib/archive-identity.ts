import type { WatchItem } from "./watch-types.ts";

export type PreparedArchiveRow = {
  source_id: string;
  theme: WatchItem["theme"];
  published_at: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  priority: WatchItem["priority"];
  tags: string;
  youtube_video_id: string | null;
};

export function extractYoutubeVideoId(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || null;
  if (host !== "youtube.com" && host !== "m.youtube.com") return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const [kind, id] = url.pathname.split("/").filter(Boolean);
  return kind === "shorts" || kind === "embed" ? id || null : null;
}

export function canonicalizeArchiveUrl(value: string) {
  const trimmed = value.trim();
  const videoId = extractYoutubeVideoId(trimmed);
  if (videoId && /^[A-Za-z0-9_-]+$/.test(videoId)) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return trimmed;
}

export function prepareArchiveRow(item: WatchItem): PreparedArchiveRow {
  return {
    source_id: String(item.id),
    theme: item.theme,
    published_at: item.date,
    title: item.title,
    summary: item.summary,
    source: item.source,
    url: canonicalizeArchiveUrl(item.url),
    priority: item.priority,
    tags: JSON.stringify(item.tags),
    youtube_video_id: extractYoutubeVideoId(item.url),
  };
}

export function matchesArchiveContent(
  existing: Pick<PreparedArchiveRow, "source_id" | "source" | "url">,
  incoming: Pick<PreparedArchiveRow, "source_id" | "source" | "url">,
) {
  return existing.source_id === incoming.source_id
    || (existing.source === incoming.source && canonicalizeArchiveUrl(existing.url) === canonicalizeArchiveUrl(incoming.url));
}

export async function archiveItemsWithStore(
  items: WatchItem[],
  upsertRows: (rows: PreparedArchiveRow[]) => Promise<void>,
) {
  if (items.length === 0) return 0;
  const rows = items.map(prepareArchiveRow);
  await upsertRows(rows);
  // Sémantique historique : nombre d'éléments traités, insertions et mises à jour confondues.
  return rows.length;
}
