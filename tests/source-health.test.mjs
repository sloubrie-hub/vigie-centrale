import assert from "node:assert/strict";
import test from "node:test";
import { assessDataReliability, calculateSourceHealth, HEALTH_WINDOW_SIZE } from "../lib/source-health.ts";

const source = (overrides = {}) => ({
  id: "france-travail", name: "France Travail", theme: "Emploi",
  connectorType: "france_travail", active: true, ...overrides,
});
const run = (status, day, errorMessage = null, collectionRunId = "run-1") => ({
  collectionRunId,
  status,
  startedAt: `2026-07-${String(day).padStart(2, "0")}T08:00:00.000Z`,
  finishedAt: `2026-07-${String(day).padStart(2, "0")}T08:00:01.000Z`,
  itemsCollected: status === "completed" ? 12 : 0,
  durationMs: 1000,
  errorMessage,
});
const collection = (status = "completed") => ({
  id: "run-1", status, startedAt: "2026-07-19T08:00:00.000Z",
  finishedAt: "2026-07-19T08:01:00.000Z", sourceTotal: 14,
  sourceSucceeded: status === "completed" ? 14 : 13, sourceFailed: status === "completed" ? 0 : 1,
  itemsCollected: 42, itemsStored: 42, errorMessage: null,
});

test("la fenêtre de santé est limitée aux 10 derniers runs", () => {
  assert.equal(HEALTH_WINDOW_SIZE, 10);
  const observations = Array.from({ length: 11 }, (_, index) => run("completed", index + 1));
  const health = calculateSourceHealth(source(), observations);
  assert.equal(health.successRate, 100);
  assert.equal(health.lastAttemptAt, "2026-07-11T08:00:01.000Z");
});

test("une source réussie est saine", () => {
  const health = calculateSourceHealth(source(), [run("completed", 19), run("completed", 18)]);
  assert.equal(health.status, "healthy");
  assert.equal(health.consecutiveFailures, 0);
  assert.equal(health.successRate, 100);
});

test("un échec isolé après un succès dégrade la source", () => {
  const health = calculateSourceHealth(source(), [run("failed", 19, "HTTP 503"), run("completed", 18)]);
  assert.equal(health.status, "degraded");
  assert.equal(health.consecutiveFailures, 1);
  assert.equal(health.recentError, "HTTP 503");
});

test("la dernière erreur connue reste exposée au-delà de la fenêtre récente", () => {
  const health = calculateSourceHealth(source(), [run("completed", 19)], null, "Ancienne erreur réseau");
  assert.equal(health.recentError, "Ancienne erreur réseau");
});

test("deux échecs consécutifs placent la source en erreur", () => {
  const health = calculateSourceHealth(source(), [run("failed", 19), run("failed", 18), run("completed", 17)]);
  assert.equal(health.status, "error");
  assert.equal(health.consecutiveFailures, 2);
});

test("un premier run échoué sans succès connu est en erreur", () => {
  assert.equal(calculateSourceHealth(source(), [run("failed", 19)]).status, "error");
});

test("une source inactive n'est jamais considérée en panne", () => {
  const health = calculateSourceHealth(source({ active: false }), [run("failed", 19)]);
  assert.equal(health.status, "inactive");
});

test("une source active sans collecte est dégradée", () => {
  const health = calculateSourceHealth(source(), []);
  assert.equal(health.status, "degraded");
  assert.equal(health.lastAttemptAt, null);
});

test("une collecte complète avec des sources saines est exploitable", () => {
  const healthy = calculateSourceHealth(source(), [run("completed", 19)]);
  assert.deepEqual(assessDataReliability(collection(), [healthy]), { status: "reliable", analysisReady: true, reasons: [] });
});

test("une collecte partielle n'est pas exploitable pour une tendance", () => {
  const healthy = calculateSourceHealth(source(), [run("completed", 19)]);
  const result = assessDataReliability(collection("partial"), [healthy]);
  assert.equal(result.status, "degraded");
  assert.equal(result.analysisReady, false);
});

test("une source requise en erreur rend son domaine inexploitable", () => {
  const failed = calculateSourceHealth(source(), [run("failed", 19)]);
  const result = assessDataReliability(collection(), [failed], ["france-travail"]);
  assert.equal(result.status, "unusable");
  assert.equal(result.analysisReady, false);
});

test("une source requise absente du registre rend le domaine inexploitable", () => {
  const result = assessDataReliability(collection(), [], ["france-travail"]);
  assert.equal(result.status, "unusable");
  assert.equal(result.analysisReady, false);
  assert.deepEqual(result.reasons, ["Source requise absente : France Travail/france-travail"]);
});

test("une source requise inactive rend le domaine inexploitable sans devenir une panne", () => {
  const inactive = calculateSourceHealth(source({ active: false }), []);
  const result = assessDataReliability(collection(), [inactive], ["france-travail"]);
  assert.equal(inactive.status, "inactive");
  assert.equal(result.status, "unusable");
  assert.equal(result.analysisReady, false);
  assert.deepEqual(result.reasons, ["Source requise inactive : France Travail"]);
});

test("un ancien succès ne remplace pas la participation au dernier run", () => {
  const historical = calculateSourceHealth(source(), [run("completed", 18, null, "run-0")]);
  const result = assessDataReliability(collection(), [historical], ["france-travail"]);
  assert.equal(historical.status, "healthy");
  assert.equal(result.status, "unusable");
  assert.equal(result.analysisReady, false);
  assert.deepEqual(result.reasons, ["Source requise absente de la dernière collecte : France Travail"]);
});

test("une source requise saine ayant participé au dernier run est exploitable", () => {
  const current = calculateSourceHealth(source(), [run("completed", 19)]);
  const result = assessDataReliability(collection(), [current], ["france-travail"]);
  assert.equal(result.status, "reliable");
  assert.equal(result.analysisReady, true);
});

test("l'absence de collecte reste un état explicite", () => {
  assert.equal(assessDataReliability(null, []).status, "unknown");
});
