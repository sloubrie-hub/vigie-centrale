import { neon } from "@neondatabase/serverless";
import type { WatchItem } from "@/lib/watch-types";

const database = () => process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

export type ArchivedItem = WatchItem;

// Route de lecture stricte : aucune création de table ni écriture implicite.
export async function readArchive(query = "", theme = "", limit = 300): Promise<ArchivedItem[]> {
  const sql = database();
  if (!sql) return [];
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const search = `%${query.trim()}%`;
  const rows = await sql`
    SELECT source_id, theme, published_at, title, summary, source, url, priority, tags, first_seen_at
    FROM watch_archive
    WHERE (${theme} = '' OR theme = ${theme})
      AND (${query.trim()} = '' OR title ILIKE ${search} OR summary ILIKE ${search} OR source ILIKE ${search})
    ORDER BY published_at DESC
    LIMIT ${safeLimit}
  `;
  return rows.map((row) => ({
    id: String(row.source_id), theme: String(row.theme) as WatchItem["theme"], kind: "live",
    date: new Date(String(row.published_at)).toISOString(), title: String(row.title),
    summary: String(row.summary), source: String(row.source), url: String(row.url),
    priority: String(row.priority) as WatchItem["priority"],
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    archivedAt: new Date(String(row.first_seen_at)).toISOString(),
  }));
}
