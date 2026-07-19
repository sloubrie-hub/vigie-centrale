import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type { CollectionStatus, CollectionSummary, SourceDefinition, SourceHealth, SourceRunStatus, WatchItem } from "@/lib/watch-types";

const database = () => process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

function requireDatabase() {
  const sql = database();
  if (!sql) throw new Error("DATABASE_URL non configurée");
  return sql;
}

export async function ensureCollectionSchema() {
  const sql = requireDatabase();
  await sql`CREATE TABLE IF NOT EXISTS watch_archive (
    source_id TEXT PRIMARY KEY, theme TEXT NOT NULL, published_at TIMESTAMPTZ NOT NULL,
    title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
    url TEXT NOT NULL, priority TEXT NOT NULL, tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS watch_archive_published_idx ON watch_archive (published_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS watch_archive_theme_idx ON watch_archive (theme)`;
  await sql`CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, theme TEXT, connector_type TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS collection_runs (
    id UUID PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
    source_total INTEGER NOT NULL DEFAULT 0, source_succeeded INTEGER NOT NULL DEFAULT 0,
    source_failed INTEGER NOT NULL DEFAULT 0, items_collected INTEGER NOT NULL DEFAULT 0,
    items_stored INTEGER NOT NULL DEFAULT 0
  )`;
  await sql`CREATE INDEX IF NOT EXISTS collection_runs_started_idx ON collection_runs (started_at DESC)`;
  await sql`CREATE TABLE IF NOT EXISTS source_runs (
    id UUID PRIMARY KEY, collection_run_id UUID NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources(id), started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL, status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
    items_collected INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS source_runs_collection_idx ON source_runs (collection_run_id)`;
  await sql`CREATE INDEX IF NOT EXISTS source_runs_source_finished_idx ON source_runs (source_id, finished_at DESC)`;
}

export async function registerSources(sources: SourceDefinition[]) {
  const sql = requireDatabase();
  for (const source of sources) {
    await sql`INSERT INTO sources (id, name, theme, connector_type, active)
      VALUES (${source.id}, ${source.name}, ${source.theme}, ${source.connectorType}, ${source.active})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, theme = EXCLUDED.theme,
        connector_type = EXCLUDED.connector_type, active = EXCLUDED.active, updated_at = NOW()`;
  }
}

export async function startCollectionRun(sourceTotal: number) {
  const sql = requireDatabase();
  const activeRuns = await sql`SELECT id FROM collection_runs
    WHERE status = 'running' AND started_at > NOW() - INTERVAL '10 minutes'
    ORDER BY started_at DESC LIMIT 1`;
  if (activeRuns.length > 0) throw new Error("Une collecte est déjà en cours");
  const id = randomUUID();
  await sql`INSERT INTO collection_runs (id, status, source_total) VALUES (${id}, 'running', ${sourceTotal})`;
  return id;
}

export async function recordSourceRun(input: {
  collectionRunId: string; sourceId: string; startedAt: string; finishedAt: string;
  status: SourceRunStatus; itemsCollected: number; durationMs: number; errorMessage?: string;
}) {
  const sql = requireDatabase();
  await sql`INSERT INTO source_runs (
    id, collection_run_id, source_id, started_at, finished_at, status,
    items_collected, duration_ms, error_message
  ) VALUES (${randomUUID()}, ${input.collectionRunId}, ${input.sourceId}, ${input.startedAt},
    ${input.finishedAt}, ${input.status}, ${input.itemsCollected}, ${input.durationMs},
    ${input.errorMessage || null})`;
}

export async function finishCollectionRun(input: {
  id: string; status: CollectionStatus; succeeded: number; failed: number;
  itemsCollected: number; itemsStored: number;
}) {
  const sql = requireDatabase();
  await sql`UPDATE collection_runs SET finished_at = NOW(), status = ${input.status},
    source_succeeded = ${input.succeeded}, source_failed = ${input.failed},
    items_collected = ${input.itemsCollected}, items_stored = ${input.itemsStored}
    WHERE id = ${input.id}`;
}

export async function archiveItems(items: WatchItem[]) {
  const sql = requireDatabase();
  if (items.length === 0) return 0;
  const rows = items.map((item) => ({
    source_id: String(item.id), theme: item.theme, published_at: item.date, title: item.title,
    summary: item.summary, source: item.source, url: item.url, priority: item.priority,
    tags: JSON.stringify(item.tags),
  }));
  await sql.transaction(rows.map((row) => sql`INSERT INTO watch_archive
    (source_id, theme, published_at, title, summary, source, url, priority, tags)
    VALUES (${row.source_id}, ${row.theme}, ${row.published_at}, ${row.title}, ${row.summary},
      ${row.source}, ${row.url}, ${row.priority}, ${row.tags}::jsonb)
    ON CONFLICT (source_id) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary,
      url = EXCLUDED.url, priority = EXCLUDED.priority, tags = EXCLUDED.tags, last_seen_at = NOW()`));
  return rows.length;
}

export async function readLatestItems(limit = 300): Promise<WatchItem[]> {
  const sql = database();
  if (!sql) return [];
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = await sql`SELECT source_id, theme, published_at, title, summary, source, url,
    priority, tags, first_seen_at FROM watch_archive ORDER BY published_at DESC LIMIT ${safeLimit}`;
  return rows.map((row) => ({
    id: String(row.source_id), theme: String(row.theme) as WatchItem["theme"], kind: "live",
    date: new Date(String(row.published_at)).toISOString(), title: String(row.title),
    summary: String(row.summary), source: String(row.source), url: String(row.url),
    priority: String(row.priority) as WatchItem["priority"],
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    archivedAt: new Date(String(row.first_seen_at)).toISOString(),
  }));
}

export async function readCollectionState(): Promise<{ collection: CollectionSummary; sources: SourceHealth[] }> {
  const sql = database();
  if (!sql) return { collection: null, sources: [] };
  let runRows;
  try {
    runRows = await sql`SELECT id, status, started_at, finished_at, source_total,
      source_succeeded, source_failed, items_collected, items_stored
      FROM collection_runs ORDER BY started_at DESC LIMIT 1`;
  } catch {
    // Compatibilité de déploiement : les archives V0 restent lisibles avant la migration additive.
    return { collection: null, sources: [] };
  }
  if (runRows.length === 0) return { collection: null, sources: [] };
  const run = runRows[0];
  const staleRunning = String(run.status) === "running"
    && Date.now() - new Date(String(run.started_at)).getTime() > 10 * 60 * 1000;
  const sourceRows = await sql`SELECT s.id, s.name, s.active, sr.status, sr.items_collected,
    sr.finished_at, sr.duration_ms, sr.error_message
    FROM sources s LEFT JOIN source_runs sr
      ON sr.source_id = s.id AND sr.collection_run_id = ${String(run.id)}
    ORDER BY s.name`;
  const running = String(run.status) === "running" && !staleRunning;
  return {
    collection: {
      id: String(run.id), status: (staleRunning ? "failed" : String(run.status)) as CollectionStatus,
      startedAt: new Date(String(run.started_at)).toISOString(),
      finishedAt: run.finished_at ? new Date(String(run.finished_at)).toISOString() : null,
      sourceTotal: Number(run.source_total), sourceSucceeded: Number(run.source_succeeded),
      sourceFailed: Number(run.source_failed), itemsCollected: Number(run.items_collected),
      itemsStored: Number(run.items_stored),
    },
    sources: sourceRows.map((row) => {
      const active = Boolean(row.active);
      const status = !active ? "api" : row.status === "failed" ? "error" : row.status === "completed" ? "live" : running ? "running" : "error";
      return {
        id: String(row.id), source: String(row.name), status,
        count: Number(row.items_collected || 0),
        detail: !active ? "Source non activée" : row.error_message ? String(row.error_message) : status === "running" ? "Acquisition en cours" : status === "live" ? "Dernière collecte réussie" : staleRunning ? "Collecte interrompue ou arrivée à expiration" : "Aucun résultat pour cette collecte",
        checkedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
        durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      } as SourceHealth;
    }),
  };
}
