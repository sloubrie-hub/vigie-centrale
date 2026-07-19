-- Lot 1 - Lecture instantanée et collecte séparée
-- Migration additive : elle ne modifie ni ne supprime watch_archive.

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
);

CREATE INDEX IF NOT EXISTS watch_archive_published_idx ON watch_archive (published_at DESC);
CREATE INDEX IF NOT EXISTS watch_archive_theme_idx ON watch_archive (theme);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  theme TEXT,
  connector_type TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collection_runs (
  id UUID PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  source_total INTEGER NOT NULL DEFAULT 0,
  source_succeeded INTEGER NOT NULL DEFAULT 0,
  source_failed INTEGER NOT NULL DEFAULT 0,
  items_collected INTEGER NOT NULL DEFAULT 0,
  items_stored INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS collection_runs_started_idx
  ON collection_runs (started_at DESC);

ALTER TABLE collection_runs
  ADD COLUMN IF NOT EXISTS error_message TEXT;

CREATE TABLE IF NOT EXISTS source_runs (
  id UUID PRIMARY KEY,
  collection_run_id UUID NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  items_collected INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS source_runs_collection_idx
  ON source_runs (collection_run_id);

CREATE INDEX IF NOT EXISTS source_runs_source_finished_idx
  ON source_runs (source_id, finished_at DESC);
