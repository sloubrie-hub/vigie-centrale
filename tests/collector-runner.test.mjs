import assert from "node:assert/strict";
import test from "node:test";
import { executeCollectorTasks } from "../lib/collector-runner.ts";
import { deriveCollectionStatus, summarizeSourceResults } from "../lib/collection-status.ts";

const source = (id) => ({ id, name: id, theme: "Emploi", connectorType: "api", active: true });
const item = { id: "item-1", theme: "Emploi", kind: "live", date: "2026-07-20T08:00:00Z", title: "Offre", summary: "", source: "Test", url: "https://example.test", priority: "Moyenne", tags: [] };

test("une source en erreur n'empêche pas les autres de terminer", async () => {
  const journal = [];
  const results = await executeCollectorTasks([
    { source: source("ok"), run: async () => [item] },
    { source: source("ko"), run: async () => { throw new Error("HTTP 500 — service indisponible"); } },
    { source: source("vide"), run: async () => [] },
  ], "run-1", async (entry) => { journal.push(entry); });

  assert.deepEqual(results.map((result) => result.ok), [true, false, true]);
  assert.deepEqual(journal.map((entry) => [entry.sourceId, entry.status, entry.itemsCollected]), [
    ["ok", "completed", 1], ["ko", "failed", 0], ["vide", "completed", 0],
  ]);
  const summary = summarizeSourceResults(results);
  assert.deepEqual(summary, { succeeded: 2, failed: 1 });
  assert.equal(deriveCollectionStatus(summary.succeeded, summary.failed), "partial");
});

test("toutes les sources en erreur rendent la collecte globale failed", async () => {
  const results = await executeCollectorTasks([
    { source: source("ko-1"), run: async () => { throw new Error("Erreur réseau"); } },
    { source: source("ko-2"), run: async () => { throw new Error("Flux RSS invalide"); } },
  ], "run-2", async () => {});
  const summary = summarizeSourceResults(results);
  assert.deepEqual(summary, { succeeded: 0, failed: 2 });
  assert.equal(deriveCollectionStatus(summary.succeeded, summary.failed), "failed");
});

test("un secret issu d'une erreur de source n'est pas journalisé", async () => {
  const journal = [];
  await executeCollectorTasks([
    { source: source("secret"), run: async () => { throw new Error("Bearer top-secret client_secret=hidden"); } },
  ], "run-3", async (entry) => { journal.push(entry); });
  assert.doesNotMatch(journal[0].errorMessage, /top-secret|hidden/);
});
