import assert from "node:assert/strict";
import test from "node:test";
import { deriveCollectionStatus, summarizeCollectionMetrics, summarizeSourceResults } from "../lib/collection-status.ts";

test("une collecte sans échec est complète", () => {
  assert.equal(deriveCollectionStatus(14, 0), "completed");
});
test("une collecte avec au moins une source en échec est partielle", () => {
  assert.equal(deriveCollectionStatus(13, 1), "partial");
});

test("une collecte sans source réussie est en échec", () => {
  assert.equal(deriveCollectionStatus(0, 14), "failed");
});

test("une source collectée mais non journalisée rend le run partiel", () => {
  const summary = summarizeSourceResults([
    { ok: true, journaled: true },
    { ok: true, journaled: false },
  ]);
  assert.deepEqual(summary, { succeeded: 1, failed: 1 });
  assert.equal(deriveCollectionStatus(summary.succeeded, summary.failed), "partial");
});

test("les métriques globales additionnent le collecté et le publié séparément", () => {
  assert.deepEqual(summarizeCollectionMetrics([
    { itemsCollected: 240, itemsPublished: 3 },
    { itemsCollected: 6, itemsPublished: 6 },
  ], 7), {
    itemsCollected: 246,
    itemsPublished: 9,
    itemsStored: 7,
  });
});
