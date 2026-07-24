import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { toJobOfferUpsertInput } from "../lib/france-travail-job-offer.ts";
import { upsertJobOfferFromSource } from "../lib/job-offer-store.ts";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("l'adaptateur France Travail alimente réellement le modèle Emploi PostgreSQL", {
  skip: !testDatabaseUrl,
  timeout: 60_000,
}, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  const sql = neon(testDatabaseUrl);
  const externalId = `lot4b-${randomUUID()}`;
  const employerMarker = `lot4b-employer-${randomUUID()}`;
  const sourceId = "france-travail";
  const firstObservedAt = "2026-07-24T10:00:00.000Z";
  const secondObservedAt = "2026-07-24T11:00:00.000Z";

  const firstOffer = {
    id: externalId,
    intitule: "Conseiller en insertion professionnelle H/F",
    description: "Première version du payload métier",
    dateCreation: "2026-07-23T08:30:00.000Z",
    typeContrat: "CDI",
    typeContratLibelle: "Contrat à durée indéterminée",
    experienceLibelle: "1 an",
    qualificationLibelle: "Technicien",
    dureeTravailLibelleConverti: "Temps plein",
    romeCode: "K1801",
    romeLibelle: "Conseil en emploi et insertion socioprofessionnelle",
    salaire: { libelle: "Mensuel de 2100 euros" },
    entreprise: { nom: employerMarker },
    lieuTravail: {
      libelle: "47 - MARMANDE",
      codePostal: "47200",
      commune: "47157",
      latitude: 44.5,
      longitude: 0.16,
    },
    origineOffre: {
      urlOrigine: `https://candidat.francetravail.fr/offres/recherche/detail/${externalId}`,
    },
    payloadVersion: 1,
  };
  const secondOffer = {
    ...firstOffer,
    description: "Deuxième version du payload métier",
    payloadVersion: 2,
  };

  try {
    const registered = await sql`SELECT id FROM sources WHERE id = ${sourceId} LIMIT 1`;
    assert.equal(registered.length, 1, "La source france-travail doit exister sur la base de test");

    const firstInput = toJobOfferUpsertInput(firstOffer, firstObservedAt);
    const first = await upsertJobOfferFromSource(firstInput);
    const secondInput = toJobOfferUpsertInput(secondOffer, secondObservedAt);
    const second = await upsertJobOfferFromSource(secondInput);

    assert.equal(first.offer.id, second.offer.id);
    assert.equal(first.source.jobOfferId, second.source.jobOfferId);
    assert.equal(first.offer.firstSeenAt, firstObservedAt);
    assert.equal(second.offer.firstSeenAt, firstObservedAt);
    assert.equal(second.offer.lastSeenAt, secondObservedAt);
    assert.equal(second.source.firstSeenAt, firstObservedAt);
    assert.equal(second.source.lastSeenAt, secondObservedAt);

    const rows = await sql`SELECT
        o.id AS job_offer_id,
        o.title_original,
        o.description_original,
        o.contract_type_original,
        o.salary_original,
        o.experience_original,
        o.qualification_original,
        o.working_time_original,
        o.publication_date,
        o.employer_name_original,
        o.location_label_original,
        o.postal_code,
        o.insee_code,
        o.latitude,
        o.longitude,
        o.rome_code_original,
        o.rome_title_original,
        o.first_seen_at AS offer_first_seen_at,
        o.last_seen_at AS offer_last_seen_at,
        s.external_id,
        s.raw_payload,
        s.first_seen_at AS source_first_seen_at,
        s.last_seen_at AS source_last_seen_at
      FROM job_offers o
      JOIN job_offer_sources s ON s.job_offer_id = o.id
      WHERE s.source_id = ${sourceId} AND s.external_id = ${externalId}`;
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(String(row.job_offer_id), first.offer.id);
    assert.equal(String(row.external_id), externalId);
    assert.equal(String(row.title_original), secondOffer.intitule);
    assert.equal(String(row.description_original), secondOffer.description);
    assert.equal(String(row.contract_type_original), secondOffer.typeContratLibelle);
    assert.equal(String(row.salary_original), secondOffer.salaire.libelle);
    assert.equal(String(row.experience_original), secondOffer.experienceLibelle);
    assert.equal(String(row.qualification_original), secondOffer.qualificationLibelle);
    assert.equal(String(row.working_time_original), secondOffer.dureeTravailLibelleConverti);
    assert.equal(String(row.employer_name_original), employerMarker);
    assert.equal(String(row.location_label_original), secondOffer.lieuTravail.libelle);
    assert.equal(String(row.postal_code), secondOffer.lieuTravail.codePostal);
    assert.equal(String(row.insee_code), secondOffer.lieuTravail.commune);
    assert.equal(Number(row.latitude), secondOffer.lieuTravail.latitude);
    assert.equal(Number(row.longitude), secondOffer.lieuTravail.longitude);
    assert.equal(String(row.rome_code_original), secondOffer.romeCode);
    assert.equal(String(row.rome_title_original), secondOffer.romeLibelle);
    assert.deepEqual(row.raw_payload, secondOffer);
    assert.equal(new Date(String(row.offer_first_seen_at)).toISOString(), firstObservedAt);
    assert.equal(new Date(String(row.source_first_seen_at)).toISOString(), firstObservedAt);
    assert.equal(new Date(String(row.offer_last_seen_at)).toISOString(), secondObservedAt);
    assert.equal(new Date(String(row.source_last_seen_at)).toISOString(), secondObservedAt);

    const integrity = await sql`SELECT
      (SELECT COUNT(*)::integer FROM job_offers
        WHERE employer_name_original = ${employerMarker}) AS offers,
      (SELECT COUNT(*)::integer FROM job_offer_sources
        WHERE source_id = ${sourceId} AND external_id = ${externalId}) AS provenances,
      (SELECT COUNT(*)::integer FROM job_offers o
        WHERE o.employer_name_original = ${employerMarker}
          AND NOT EXISTS (
            SELECT 1 FROM job_offer_sources s WHERE s.job_offer_id = o.id
          )) AS orphans,
      (SELECT COUNT(*)::integer FROM (
        SELECT source_id, external_id
        FROM job_offer_sources
        WHERE source_id = ${sourceId} AND external_id = ${externalId}
        GROUP BY source_id, external_id
        HAVING COUNT(*) > 1
      ) duplicates) AS duplicates`;
    assert.equal(Number(integrity[0].offers), 1);
    assert.equal(Number(integrity[0].provenances), 1);
    assert.equal(Number(integrity[0].orphans), 0);
    assert.equal(Number(integrity[0].duplicates), 0);
  } finally {
    await sql`DELETE FROM job_offer_sources
      WHERE (source_id = ${sourceId} AND external_id = ${externalId})
        OR job_offer_id IN (
          SELECT id FROM job_offers WHERE employer_name_original = ${employerMarker}
        )`;
    await sql`DELETE FROM job_offers WHERE employer_name_original = ${employerMarker}`;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
