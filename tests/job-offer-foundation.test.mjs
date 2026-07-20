import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

class MemoryJobOfferStore {
  offers = new Map();
  sources = new Map();
  sequence = 0;

  upsert(input, { failProvenance = false } = {}) {
    const key = `${input.source.sourceId}\u001f${input.source.externalId}`;
    const previousSource = this.sources.get(key);
    const offerId = previousSource?.jobOfferId ?? `offer-${++this.sequence}`;
    const sourceId = previousSource?.id ?? `provenance-${this.sequence}`;
    const previousOffer = this.offers.get(offerId);
    const observedAt = input.observedAt;

    const nextOffer = {
      ...input.offer,
      id: offerId,
      firstSeenAt: previousOffer?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
    };
    const nextSource = {
      ...input.source,
      id: sourceId,
      jobOfferId: offerId,
      firstSeenAt: previousSource?.firstSeenAt ?? observedAt,
      lastSeenAt: observedAt,
    };

    // Simule le commit atomique de l'instruction PostgreSQL : aucun état partiel.
    if (failProvenance) throw new Error("Échec provenance");
    this.offers.set(offerId, nextOffer);
    this.sources.set(key, nextSource);
    return { offer: nextOffer, source: nextSource };
  }
}

const sample = ({ sourceId = "france-travail", externalId = "123", observedAt = "2026-07-20T08:00:00.000Z" } = {}) => ({
  observedAt,
  offer: {
    titleOriginal: "Technicien de maintenance H/F",
    descriptionOriginal: "Valeur source inchangée",
    contractTypeOriginal: "CDI",
    titleNormalized: null,
    salaryOriginal: null,
    latitude: null,
    longitude: null,
  },
  source: {
    sourceId,
    externalId,
    sourceUrl: "https://candidat.francetravail.fr/offres/recherche/detail/123",
    rawPayload: { id: externalId, intitule: "Technicien de maintenance H/F" },
  },
});

test("une nouvelle offre externe crée une offre et une provenance", () => {
  const store = new MemoryJobOfferStore();
  const result = store.upsert(sample());
  assert.equal(store.offers.size, 1);
  assert.equal(store.sources.size, 1);
  assert.equal(result.source.jobOfferId, result.offer.id);
  assert.equal(result.offer.descriptionOriginal, "Valeur source inchangée");
  assert.equal(result.offer.titleNormalized, null);
  assert.equal(result.offer.salaryOriginal, null);
});

test("la même source et le même identifiant actualisent la même offre", () => {
  const store = new MemoryJobOfferStore();
  const first = store.upsert(sample());
  const secondInput = sample({ observedAt: "2026-07-20T09:00:00.000Z" });
  secondInput.offer.descriptionOriginal = "Payload actualisé";
  secondInput.source.rawPayload = { id: "123", intitule: "Titre actualisé" };
  const second = store.upsert(secondInput);

  assert.equal(second.offer.id, first.offer.id);
  assert.equal(store.offers.size, 1);
  assert.equal(store.sources.size, 1);
  assert.equal(second.offer.firstSeenAt, first.offer.firstSeenAt);
  assert.equal(second.offer.lastSeenAt, "2026-07-20T09:00:00.000Z");
  assert.deepEqual(second.source.rawPayload, { id: "123", intitule: "Titre actualisé" });
});

test("le même identifiant externe dans deux sources ne déclenche aucune fusion", () => {
  const store = new MemoryJobOfferStore();
  const first = store.upsert(sample({ sourceId: "france-travail" }));
  const second = store.upsert(sample({ sourceId: "autre-source" }));
  assert.notEqual(first.offer.id, second.offer.id);
  assert.equal(store.offers.size, 2);
  assert.equal(store.sources.size, 2);
});

test("un échec de provenance ne laisse aucune offre orpheline", () => {
  const store = new MemoryJobOfferStore();
  assert.throws(() => store.upsert(sample(), { failProvenance: true }), /Échec provenance/);
  assert.equal(store.offers.size, 0);
  assert.equal(store.sources.size, 0);
});

test("la migration définit les clés, contraintes et index du socle", async () => {
  const migration = await read("migrations/002_job_offer_foundation.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS job_offers/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS job_offer_sources/);
  assert.match(migration, /job_offer_id UUID NOT NULL REFERENCES job_offers\(id\) ON DELETE CASCADE/);
  assert.match(migration, /source_id TEXT NOT NULL REFERENCES sources\(id\)/);
  assert.match(migration, /UNIQUE \(source_id, external_id\)/);
  assert.match(migration, /raw_payload JSONB NOT NULL/);
  assert.match(migration, /job_offers_last_seen_idx/);
  assert.match(migration, /job_offer_sources_offer_idx/);
  assert.doesNotMatch(migration, /DROP |TRUNCATE |DELETE FROM|INSERT INTO/);
});

test("l'upsert SQL est atomique, concurrent et conserve l'identité canonique", async () => {
  const store = await read("lib/job-offer-store.ts");
  assert.match(store, /pg_advisory_xact_lock/);
  assert.match(store, /WITH source_lock AS MATERIALIZED/);
  assert.match(store, /ON CONFLICT \(source_id, external_id\) DO UPDATE/);
  assert.match(store, /WHERE id = \(SELECT job_offer_id FROM upserted_source\)/);
  assert.match(store, /SELECT \* FROM created_offer\s+UNION ALL\s+SELECT \* FROM updated_offer/);
  assert.match(store, /raw_payload = EXCLUDED\.raw_payload/);
  assert.match(store, /first_seen_at AS offer_first_seen_at/);
  assert.doesNotMatch(store, /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP TABLE/);
});

test("les types distinguent entrées, enregistrements et JSON sans any", async () => {
  const types = await read("lib/job-offer-types.ts");
  assert.match(types, /type JobOfferInput/);
  assert.match(types, /type JobOfferSourceInput/);
  assert.match(types, /type JobOfferRecord/);
  assert.match(types, /type JobOfferSourceRecord/);
  assert.match(types, /type JsonValue/);
  assert.doesNotMatch(types, /\bany\b/);
});

test("le Lot 4A ne modifie ni collecte, ni archive, ni routes publiques", async () => {
  const publicRoute = await read("app/api/veille/route.ts");
  const cronRoute = await read("app/api/cron/archive/route.ts");
  const collector = await read("lib/collector.ts");
  const collectionStore = await read("lib/collection-store.ts");

  assert.doesNotMatch(publicRoute, /job_offers|job_offer_sources|upsertJobOffer/);
  assert.doesNotMatch(publicRoute, /runCollection|fetch\(|INSERT|UPDATE|DELETE/);
  assert.match(cronRoute, /authorization/);
  assert.doesNotMatch(collector, /job_offers|upsertJobOffer/);
  assert.doesNotMatch(collectionStore, /job_offers|job_offer_sources/);
});
