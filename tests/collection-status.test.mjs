import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
    { itemsCollected: 100, itemsPublished: 3 },
    { itemsCollected: 4, itemsPublished: 4 },
  ], 6), { itemsCollected: 104, itemsPublished: 7, itemsStored: 6 });
});

test("la réponse cron conserve collected et stored avec leur sens historique", async () => {
  const collector = await readFile(new URL("../lib/collector.ts", import.meta.url), "utf8");
  assert.match(collector, /collected: metrics\.itemsPublished/);
  assert.match(collector, /\.\.\.metrics/);
  assert.match(collector, /\bstored,/);
});
