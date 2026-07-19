-- LOT 3 — NETTOYAGE DE TRANSITION DES IDENTIFIANTS
-- À EXÉCUTER UNIQUEMENT SUR LA BRANCHE NEON PREVIEW, JAMAIS SUR PRODUCTION.
--
-- Avant exécution, utiliser la requête de contrôle documentée en fin de fichier.

BEGIN;

WITH normalized AS (
  SELECT
    watch_archive.*,
    CASE
      WHEN source LIKE '%— YouTube' THEN COALESCE(
        SUBSTRING(url FROM '[?&]v=([A-Za-z0-9_-]+)'),
        SUBSTRING(url FROM 'youtu\.be/([A-Za-z0-9_-]+)'),
        SUBSTRING(url FROM '/shorts/([A-Za-z0-9_-]+)'),
        SUBSTRING(url FROM '/embed/([A-Za-z0-9_-]+)'),
        url
      )
      ELSE url
    END AS content_key
  FROM watch_archive
  WHERE url <> ''
), ranked AS (
  SELECT
    source_id,
    FIRST_VALUE(source_id) OVER (
      PARTITION BY source, content_key
      ORDER BY first_seen_at ASC, source_id ASC
    ) AS survivor_id,
    MAX(last_seen_at) OVER (PARTITION BY source, content_key) AS latest_seen_at,
    ROW_NUMBER() OVER (
      PARTITION BY source, content_key
      ORDER BY first_seen_at ASC, source_id ASC
    ) AS duplicate_rank,
    BOOL_OR(source_id ~ '^rss-[0-9a-f]{24}$' OR source_id ~ '^youtube-[A-Za-z0-9_-]+$')
      OVER (PARTITION BY source, content_key) AS contains_lot3_id
  FROM normalized
), refreshed_survivors AS (
  UPDATE watch_archive survivor
  SET last_seen_at = ranked.latest_seen_at
  FROM ranked
  WHERE survivor.source_id = ranked.survivor_id
    AND ranked.contains_lot3_id
  RETURNING survivor.source_id
)
DELETE FROM watch_archive duplicate
USING ranked
WHERE duplicate.source_id = ranked.source_id
  AND ranked.duplicate_rank > 1
  AND ranked.contains_lot3_id;

COMMIT;

-- CONTRÔLE AVANT/APRÈS : après nettoyage, cette requête doit retourner zéro ligne.
-- WITH normalized AS (
--   SELECT source, source_id, first_seen_at,
--     CASE WHEN source LIKE '%— YouTube' THEN COALESCE(
--       SUBSTRING(url FROM '[?&]v=([A-Za-z0-9_-]+)'),
--       SUBSTRING(url FROM 'youtu\.be/([A-Za-z0-9_-]+)'),
--       SUBSTRING(url FROM '/shorts/([A-Za-z0-9_-]+)'),
--       SUBSTRING(url FROM '/embed/([A-Za-z0-9_-]+)'), url
--     ) ELSE url END AS content_key
--   FROM watch_archive WHERE url <> ''
-- )
-- SELECT source, content_key, COUNT(*) AS copies,
--   ARRAY_AGG(source_id ORDER BY first_seen_at) AS ids
-- FROM normalized
-- GROUP BY source, content_key
-- HAVING COUNT(*) > 1
--   AND BOOL_OR(source_id ~ '^rss-[0-9a-f]{24}$' OR source_id ~ '^youtube-[A-Za-z0-9_-]+$');
