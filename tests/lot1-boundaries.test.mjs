import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la route publique de veille est strictement en lecture", async () => {
  const route = await read("app/api/veille/route.ts");
  assert.match(route, /readLatestItems/);
  assert.match(route, /readCollectionState/);
  assert.doesNotMatch(route, /runCollection|archiveItems|fetch\(/);
});

test("la santé des sources reste calculée depuis l'historique, sans table de synthèse", async () => {
  const store = await read("lib/collection-store.ts");
  const migration = await read("migrations/001_lot1_collection_runs.sql");
  assert.match(store, /source_runs/);
  assert.match(store, /HEALTH_WINDOW_SIZE/);
  assert.doesNotMatch(store, /source_health/);
  assert.doesNotMatch(migration, /source_health/);
});

test("la route archives ne crée plus le schéma", async () => {
  const archive = await read("lib/archive.ts");
  assert.doesNotMatch(archive, /CREATE TABLE|INSERT INTO|UPDATE |DELETE FROM/);
});

test("la migration est l’unique source de vérité du schéma", async () => {
  const collector = await read("lib/collector.ts");
  const store = await read("lib/collection-store.ts");
  assert.doesNotMatch(collector, /ensureCollectionSchema/);
  assert.doesNotMatch(store, /CREATE TABLE|CREATE INDEX/);
});

test("tous les accès HTTP externes passent par un timeout explicite", async () => {
  const collector = await read("lib/collector.ts");
  const http = await read("lib/http-client.ts");
  const runner = await read("lib/collector-runner.ts");
  assert.doesNotMatch(collector, /\bfetch\(/);
  assert.match(http, /AbortController/);
  assert.match(http, /DEFAULT_HTTP_TIMEOUT_MS/);
  assert.match(runner, /SOURCE_TIMEOUT_MS/);
});

test("un run concurrent récent est refusé et un run bloqué devient caduc", async () => {
  const store = await read("lib/collection-store.ts");
  assert.match(store, /Une collecte est déjà en cours/);
  assert.match(store, /10 \* 60 \* 1000/);
});

test("une erreur de journalisation de source ne rejette pas Promise.all", async () => {
  const collector = await read("lib/collector.ts");
  const runner = await read("lib/collector-runner.ts");
  assert.match(runner, /journaled: false/);
  assert.match(runner, /Promise\.allSettled/);
  assert.match(collector, /Journalisation incomplète/);
  assert.match(collector, /Finalisation du run impossible/);
});
