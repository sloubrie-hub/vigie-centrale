-- Lot 5 - Distinction entre volumes collectés et éléments publiés
-- Migration additive : les historiques reprennent la sémantique antérieure.

ALTER TABLE source_runs
  ADD COLUMN IF NOT EXISTS items_published INTEGER;

UPDATE source_runs
SET items_published = items_collected
WHERE items_published IS NULL;

ALTER TABLE source_runs
  ALTER COLUMN items_published SET DEFAULT 0,
  ALTER COLUMN items_published SET NOT NULL;

ALTER TABLE collection_runs
  ADD COLUMN IF NOT EXISTS items_published INTEGER;

UPDATE collection_runs
SET items_published = items_collected
WHERE items_published IS NULL;

ALTER TABLE collection_runs
  ALTER COLUMN items_published SET DEFAULT 0,
  ALTER COLUMN items_published SET NOT NULL;
