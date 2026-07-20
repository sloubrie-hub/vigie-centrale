import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { neon } from "@neondatabase/serverless";
import { upsertJobOfferFromSource } from "../lib/job-offer-store.ts";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

test("deux upserts PostgreSQL concurrents conservent une seule offre atomique", {
  skip: !testDatabaseUrl,
  timeout: 60_000,
}, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  const sql = neon(testDatabaseUrl);
  const testMarker = `lot4a-concurrency-${randomUUID()}`;
  const rollbackMarker = `lot4a-rollback-${randomUUID()}`;
  const externalId = testMarker;
  const sourceId = "france-travail";

  try {
    const registered = await sql`SELECT id FROM sources WHERE id = ${sourceId} LIMIT 1`;
    assert.equal(registered.length, 1, "La source france-travail doit exister sur la base de test");

    const older = {
      observedAt: "2026-07-20T08:00:00.000Z",
      offer: {
        titleOriginal: "Test concurrence ancien",
        employerNameOriginal: testMarker,
      },
      source: {
        sourceId,
        externalId,
        sourceUrl: `https://example.invalid/${externalId}`,
        rawPayload: { version: "ancienne" },
      },
    };
    const newer = {
      ...older,
      observedAt: "2026-07-20T09:00:00.000Z",
      offer: {
        titleOriginal: "Test concurrence récent",
        employerNameOriginal: testMarker,
      },
      source: { ...older.source, rawPayload: { version: "récente" } },
    };

    const [first, second] = await Promise.all([
      upsertJobOfferFromSource(older),
      upsertJobOfferFromSource(newer),
    ]);
    assert.equal(second.offer.id, first.offer.id);

    const counts = await sql`SELECT
      (SELECT COUNT(*)::integer FROM job_offers
        WHERE employer_name_original = ${testMarker}) AS offers,
      (SELECT COUNT(*)::integer FROM job_offer_sources
        WHERE source_id = ${sourceId} AND external_id = ${externalId}) AS provenances,
      (SELECT COUNT(*)::integer FROM job_offers o
        WHERE o.employer_name_original = ${testMarker} AND NOT EXISTS (
          SELECT 1 FROM job_offer_sources s WHERE s.job_offer_id = o.id
        )) AS orphans`;
    assert.equal(Number(counts[0].offers), 1);
    assert.equal(Number(counts[0].provenances), 1);
    assert.equal(Number(counts[0].orphans), 0);

    const persisted = await sql`SELECT s.raw_payload, s.last_seen_at, o.last_seen_at AS offer_last_seen_at
      FROM job_offer_sources s JOIN job_offers o ON o.id = s.job_offer_id
      WHERE s.source_id = ${sourceId} AND s.external_id = ${externalId}`;
    assert.deepEqual(persisted[0].raw_payload, { version: "récente" });
    assert.equal(new Date(String(persisted[0].last_seen_at)).toISOString(), newer.observedAt);
    assert.equal(new Date(String(persisted[0].offer_last_seen_at)).toISOString(), newer.observedAt);

    await assert.rejects(() => upsertJobOfferFromSource({
      observedAt: newer.observedAt,
      offer: {
        titleOriginal: "Test rollback",
        employerNameOriginal: rollbackMarker,
      },
      source: {
        sourceId: `source-absente-${randomUUID()}`,
        externalId: randomUUID(),
        rawPayload: { test: true },
      },
    }));
    const rolledBack = await sql`SELECT COUNT(*)::integer AS count
      FROM job_offers WHERE employer_name_original = ${rollbackMarker}`;
    assert.equal(Number(rolledBack[0].count), 0, "L'échec de provenance doit annuler l'offre");
  } finally {
    await sql`DELETE FROM job_offer_sources
      WHERE (source_id = ${sourceId} AND external_id = ${externalId})
        OR job_offer_id IN (
          SELECT id FROM job_offers
          WHERE employer_name_original IN (${testMarker}, ${rollbackMarker})
        )`;
    await sql`DELETE FROM job_offers
      WHERE employer_name_original IN (${testMarker}, ${rollbackMarker})`;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
