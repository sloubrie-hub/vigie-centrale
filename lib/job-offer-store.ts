import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type {
  JobOfferRecord,
  JobOfferSourceRecord,
  JobOfferWithSourceRecord,
  JsonValue,
  UpsertJobOfferFromSourceInput,
} from "@/lib/job-offer-types";

const database = () => process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null;

function requireDatabase() {
  const sql = database();
  if (!sql) throw new Error("DATABASE_URL non configurée");
  return sql;
}

function iso(value: unknown): string {
  return new Date(String(value)).toISOString();
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapOffer(row: Record<string, unknown>): JobOfferRecord {
  return {
    id: String(row.offer_id ?? row.id),
    titleOriginal: String(row.title_original),
    titleNormalized: nullableString(row.title_normalized),
    descriptionOriginal: nullableString(row.description_original),
    contractTypeOriginal: nullableString(row.contract_type_original),
    contractTypeNormalized: nullableString(row.contract_type_normalized),
    salaryOriginal: nullableString(row.salary_original),
    experienceOriginal: nullableString(row.experience_original),
    qualificationOriginal: nullableString(row.qualification_original),
    workingTimeOriginal: nullableString(row.working_time_original),
    publicationDate: row.publication_date ? iso(row.publication_date) : null,
    employerNameOriginal: nullableString(row.employer_name_original),
    employerSiret: nullableString(row.employer_siret),
    employerSiren: nullableString(row.employer_siren),
    locationLabelOriginal: nullableString(row.location_label_original),
    postalCode: nullableString(row.postal_code),
    inseeCode: nullableString(row.insee_code),
    latitude: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    romeCodeOriginal: nullableString(row.rome_code_original),
    romeTitleOriginal: nullableString(row.rome_title_original),
    firstSeenAt: iso(row.offer_first_seen_at ?? row.first_seen_at),
    lastSeenAt: iso(row.offer_last_seen_at ?? row.last_seen_at),
    active: Boolean(row.active),
    createdAt: iso(row.offer_created_at ?? row.created_at),
    updatedAt: iso(row.offer_updated_at ?? row.updated_at),
  };
}

function mapSource(row: Record<string, unknown>): JobOfferSourceRecord {
  return {
    id: String(row.provenance_id),
    jobOfferId: String(row.offer_id),
    sourceId: String(row.source_id),
    externalId: String(row.external_id),
    sourceUrl: nullableString(row.source_url),
    rawPayload: row.raw_payload as JsonValue,
    firstSeenAt: iso(row.source_first_seen_at),
    lastSeenAt: iso(row.source_last_seen_at),
    createdAt: iso(row.source_created_at),
    updatedAt: iso(row.source_updated_at),
  };
}

function validateInput(input: UpsertJobOfferFromSourceInput) {
  if (!input.offer.titleOriginal.trim()) throw new Error("Le titre original est obligatoire");
  if (!input.source.sourceId.trim()) throw new Error("L’identifiant de source est obligatoire");
  if (!input.source.externalId.trim()) throw new Error("L’identifiant externe est obligatoire");
  if (input.offer.latitude != null && (input.offer.latitude < -90 || input.offer.latitude > 90)) {
    throw new Error("Latitude invalide");
  }
  if (input.offer.longitude != null && (input.offer.longitude < -180 || input.offer.longitude > 180)) {
    throw new Error("Longitude invalide");
  }
}

/**
 * Crée ou actualise une offre et sa provenance dans une transaction atomique.
 * Le verrou est acquis dans une première instruction : sous ReadCommitted,
 * l'upsert suivant reçoit ainsi un snapshot postérieur à l'attente du verrou.
 */
export async function upsertJobOfferFromSource(
  input: UpsertJobOfferFromSourceInput,
): Promise<JobOfferWithSourceRecord> {
  validateInput(input);
  const sql = requireDatabase();
  const offerId = randomUUID();
  const provenanceId = randomUUID();
  const observedAt = input.observedAt ?? new Date().toISOString();
  const offer = input.offer;
  const source = input.source;
  const rawPayload = JSON.stringify(source.rawPayload);

  const transactionResults = await sql.transaction((txn) => [
    txn`SELECT pg_advisory_xact_lock(
      hashtextextended(${source.sourceId} || chr(31) || ${source.externalId}, 0)
    )`,
    txn`WITH existing_source AS MATERIALIZED (
      SELECT jos.job_offer_id
      FROM job_offer_sources jos
      WHERE jos.source_id = ${source.sourceId} AND jos.external_id = ${source.externalId}
    ), created_offer AS (
      INSERT INTO job_offers (
        id, title_original, title_normalized, description_original,
        contract_type_original, contract_type_normalized, salary_original,
        experience_original, qualification_original, working_time_original,
        publication_date, employer_name_original, employer_siret, employer_siren,
        location_label_original, postal_code, insee_code, latitude, longitude,
        rome_code_original, rome_title_original, first_seen_at, last_seen_at,
        active, created_at, updated_at
      )
      SELECT ${offerId}, ${offer.titleOriginal}, ${offer.titleNormalized ?? null},
        ${offer.descriptionOriginal ?? null}, ${offer.contractTypeOriginal ?? null},
        ${offer.contractTypeNormalized ?? null}, ${offer.salaryOriginal ?? null},
        ${offer.experienceOriginal ?? null}, ${offer.qualificationOriginal ?? null},
        ${offer.workingTimeOriginal ?? null}, ${offer.publicationDate ?? null},
        ${offer.employerNameOriginal ?? null}, ${offer.employerSiret ?? null},
        ${offer.employerSiren ?? null}, ${offer.locationLabelOriginal ?? null},
        ${offer.postalCode ?? null}, ${offer.inseeCode ?? null}, ${offer.latitude ?? null},
        ${offer.longitude ?? null}, ${offer.romeCodeOriginal ?? null},
        ${offer.romeTitleOriginal ?? null}, ${observedAt}, ${observedAt},
        ${offer.active ?? true}, ${observedAt}, ${observedAt}
      WHERE NOT EXISTS (SELECT 1 FROM existing_source)
      RETURNING *
    ), resolved_offer AS (
      SELECT job_offer_id AS id FROM existing_source
      UNION ALL
      SELECT id FROM created_offer
    ), upserted_source AS (
      INSERT INTO job_offer_sources AS current_source (
        id, job_offer_id, source_id, external_id, source_url, raw_payload,
        first_seen_at, last_seen_at, created_at, updated_at
      )
      SELECT ${provenanceId}, id, ${source.sourceId}, ${source.externalId},
        ${source.sourceUrl ?? null}, ${rawPayload}::jsonb,
        ${observedAt}, ${observedAt}, ${observedAt}, ${observedAt}
      FROM resolved_offer
      ON CONFLICT (source_id, external_id) DO UPDATE SET
        source_url = CASE
          WHEN EXCLUDED.last_seen_at >= current_source.last_seen_at
          THEN EXCLUDED.source_url ELSE current_source.source_url END,
        raw_payload = CASE
          WHEN EXCLUDED.last_seen_at >= current_source.last_seen_at
          THEN EXCLUDED.raw_payload ELSE current_source.raw_payload END,
        last_seen_at = GREATEST(current_source.last_seen_at, EXCLUDED.last_seen_at),
        updated_at = GREATEST(current_source.updated_at, EXCLUDED.updated_at)
      RETURNING *
    ), updated_offer AS (
      UPDATE job_offers SET
        title_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.titleOriginal} ELSE title_original END,
        title_normalized = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.titleNormalized ?? null} ELSE title_normalized END,
        description_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.descriptionOriginal ?? null} ELSE description_original END,
        contract_type_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.contractTypeOriginal ?? null} ELSE contract_type_original END,
        contract_type_normalized = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.contractTypeNormalized ?? null} ELSE contract_type_normalized END,
        salary_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.salaryOriginal ?? null} ELSE salary_original END,
        experience_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.experienceOriginal ?? null} ELSE experience_original END,
        qualification_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.qualificationOriginal ?? null} ELSE qualification_original END,
        working_time_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.workingTimeOriginal ?? null} ELSE working_time_original END,
        publication_date = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.publicationDate ?? null} ELSE publication_date END,
        employer_name_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.employerNameOriginal ?? null} ELSE employer_name_original END,
        employer_siret = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.employerSiret ?? null} ELSE employer_siret END,
        employer_siren = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.employerSiren ?? null} ELSE employer_siren END,
        location_label_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.locationLabelOriginal ?? null} ELSE location_label_original END,
        postal_code = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.postalCode ?? null} ELSE postal_code END,
        insee_code = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.inseeCode ?? null} ELSE insee_code END,
        latitude = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.latitude ?? null} ELSE latitude END,
        longitude = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.longitude ?? null} ELSE longitude END,
        rome_code_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.romeCodeOriginal ?? null} ELSE rome_code_original END,
        rome_title_original = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.romeTitleOriginal ?? null} ELSE rome_title_original END,
        last_seen_at = GREATEST(last_seen_at, ${observedAt}::timestamptz),
        active = CASE WHEN ${observedAt}::timestamptz >= last_seen_at THEN ${offer.active ?? true} ELSE active END,
        updated_at = GREATEST(updated_at, ${observedAt}::timestamptz)
      WHERE id = (SELECT job_offer_id FROM upserted_source)
        AND EXISTS (SELECT 1 FROM existing_source)
      RETURNING *
    ), resolved_offer_row AS (
      SELECT * FROM created_offer
      UNION ALL
      SELECT * FROM updated_offer
    )
    SELECT o.id AS offer_id, o.title_original, o.title_normalized, o.description_original,
      o.contract_type_original, o.contract_type_normalized, o.salary_original,
      o.experience_original, o.qualification_original, o.working_time_original,
      o.publication_date, o.employer_name_original, o.employer_siret, o.employer_siren,
      o.location_label_original, o.postal_code, o.insee_code, o.latitude, o.longitude,
      o.rome_code_original, o.rome_title_original, o.first_seen_at AS offer_first_seen_at,
      o.last_seen_at AS offer_last_seen_at, o.active, o.created_at AS offer_created_at,
      o.updated_at AS offer_updated_at, s.id AS provenance_id, s.source_id, s.external_id,
      s.source_url, s.raw_payload, s.first_seen_at AS source_first_seen_at,
      s.last_seen_at AS source_last_seen_at, s.created_at AS source_created_at,
      s.updated_at AS source_updated_at
    FROM resolved_offer_row o JOIN upserted_source s ON s.job_offer_id = o.id`,
  ], { isolationLevel: "ReadCommitted" });

  const rows = transactionResults[1];

  if (rows.length !== 1) throw new Error("La persistance atomique de l’offre a échoué");
  const row = rows[0] as Record<string, unknown>;
  return { offer: mapOffer(row), source: mapSource(row) };
}

export async function readJobOfferById(id: string): Promise<JobOfferRecord | null> {
  const sql = requireDatabase();
  const rows = await sql`SELECT * FROM job_offers WHERE id = ${id} LIMIT 1`;
  return rows.length === 0 ? null : mapOffer(rows[0] as Record<string, unknown>);
}

export async function readJobOfferBySource(
  sourceId: string,
  externalId: string,
): Promise<JobOfferWithSourceRecord | null> {
  const sql = requireDatabase();
  const rows = await sql`SELECT o.id AS offer_id, o.title_original, o.title_normalized,
      o.description_original, o.contract_type_original, o.contract_type_normalized,
      o.salary_original, o.experience_original, o.qualification_original,
      o.working_time_original, o.publication_date, o.employer_name_original,
      o.employer_siret, o.employer_siren, o.location_label_original, o.postal_code,
      o.insee_code, o.latitude, o.longitude, o.rome_code_original, o.rome_title_original,
      o.first_seen_at AS offer_first_seen_at, o.last_seen_at AS offer_last_seen_at,
      o.active, o.created_at AS offer_created_at, o.updated_at AS offer_updated_at,
      s.id AS provenance_id, s.source_id, s.external_id, s.source_url, s.raw_payload,
      s.first_seen_at AS source_first_seen_at, s.last_seen_at AS source_last_seen_at,
      s.created_at AS source_created_at, s.updated_at AS source_updated_at
    FROM job_offer_sources s JOIN job_offers o ON o.id = s.job_offer_id
    WHERE s.source_id = ${sourceId} AND s.external_id = ${externalId} LIMIT 1`;
  if (rows.length === 0) return null;
  const row = rows[0] as Record<string, unknown>;
  return { offer: mapOffer(row), source: mapSource(row) };
}

export async function listRecentJobOffers(options: { limit?: number; offset?: number } = {}) {
  const sql = requireDatabase();
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 50), 100));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const rows = await sql`SELECT * FROM job_offers
    ORDER BY last_seen_at DESC, id ASC LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((row) => mapOffer(row as Record<string, unknown>));
}
