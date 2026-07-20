-- Lot 4A - Socle du modèle de données Emploi
-- Migration additive : aucune table existante n'est modifiée ou supprimée.

CREATE TABLE IF NOT EXISTS job_offers (
  id UUID PRIMARY KEY,
  title_original TEXT NOT NULL,
  title_normalized TEXT,
  description_original TEXT,
  contract_type_original TEXT,
  contract_type_normalized TEXT,
  salary_original TEXT,
  experience_original TEXT,
  qualification_original TEXT,
  working_time_original TEXT,
  publication_date TIMESTAMPTZ,
  employer_name_original TEXT,
  employer_siret TEXT,
  employer_siren TEXT,
  location_label_original TEXT,
  postal_code TEXT,
  insee_code TEXT,
  latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  rome_code_original TEXT,
  rome_title_original TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_offers_last_seen_idx
  ON job_offers (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS job_offers_publication_idx
  ON job_offers (publication_date DESC);

CREATE INDEX IF NOT EXISTS job_offers_active_last_seen_idx
  ON job_offers (last_seen_at DESC)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS job_offer_sources (
  id UUID PRIMARY KEY,
  job_offer_id UUID NOT NULL REFERENCES job_offers(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  source_url TEXT,
  raw_payload JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT job_offer_sources_source_external_unique UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS job_offer_sources_offer_idx
  ON job_offer_sources (job_offer_id);

CREATE INDEX IF NOT EXISTS job_offer_sources_last_seen_idx
  ON job_offer_sources (source_id, last_seen_at DESC);
