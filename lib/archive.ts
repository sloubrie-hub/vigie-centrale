import { neon } from "@neondatabase/serverless";

export type ArchivedItem = {
  id: string;
  theme: string;
  kind: "live";
  date: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  priority: string;
  tags: string[];
  archivedAt?: string;
};

const database = () => process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

async function ensureSchema(sql: NonNullable<ReturnType<typeof database>>) {
  await sql`
    CREATE TABLE IF NOT EXISTS watch_archive (
      source_id TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      published_at TIMESTAMPTZ NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      priority TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS watch_archive_published_idx ON watch_archive (published_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS watch_archive_theme_idx ON watch_archive (theme)`;
}

export async function archiveItems(items: ArchivedItem[]) {
  const sql = database();
  if (!sql) return { enabled: false, stored: 0 };
  await ensureSchema(sql);
  for (const item of items) {
    await sql`
      INSERT INTO watch_archive (source_id, theme, published_at, title, summary, source, url, priority, tags)
      VALUES (${String(item.id)}, ${item.theme}, ${item.date}, ${item.title}, ${item.summary}, ${item.source}, ${item.url}, ${item.priority}, ${JSON.stringify(item.tags)}::jsonb)
      ON CONFLICT (source_id) DO UPDATE SET
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        url = EXCLUDED.url,
        priority = EXCLUDED.priority,
        tags = EXCLUDED.tags,
        last_seen_at = NOW()
    `;
  }
  return { enabled: true, stored: items.length };
}

export async function readArchive(query = "", theme = "", limit = 300): Promise<ArchivedItem[]> {
  const sql = database();
  if (!sql) return [];
  await ensureSchema(sql);
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
    id: String(row.source_id), theme: String(row.theme), kind: "live", date: new Date(String(row.published_at)).toISOString(),
    title: String(row.title), summary: String(row.summary), source: String(row.source), url: String(row.url),
    priority: String(row.priority), tags: Array.isArray(row.tags) ? row.tags.map(String) : [], archivedAt: new Date(String(row.first_seen_at)).toISOString(),
  }));
}
