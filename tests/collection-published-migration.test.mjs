import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("la migration 003 ajoute et initialise items_published sans destruction", async () => {
  const migration = await read("migrations/003_collection_published_counts.sql");
  for (const table of ["source_runs", "collection_runs"]) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*ADD COLUMN IF NOT EXISTS items_published INTEGER`));
    assert.match(migration, new RegExp(`UPDATE ${table}[\\s\\S]*SET items_published = items_collected[\\s\\S]*WHERE items_published IS NULL`));
    assert.match(migration, new RegExp(`ALTER TABLE ${table}[\\s\\S]*items_published SET DEFAULT 0[\\s\\S]*items_published SET NOT NULL`));
  }
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
});

test("les migrations 001 et 002 restent inchangées par le Lot 5", async () => {
  assert.doesNotMatch(await read("migrations/001_lot1_collection_runs.sql"), /items_published/);
  assert.doesNotMatch(await read("migrations/002_job_offer_foundation.sql"), /items_published/);
});

test("aucun DDL Lot 5 n'est exécuté au runtime", async () => {
  for (const path of ["lib/collector.ts", "lib/collector-runner.ts", "lib/collection-store.ts"]) {
    assert.doesNotMatch(await read(path), /CREATE TABLE|CREATE INDEX|ALTER TABLE|DROP TABLE|TRUNCATE TABLE/i);
  }
});
