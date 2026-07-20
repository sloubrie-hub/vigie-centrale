import assert from "node:assert/strict";
import test from "node:test";
import { archiveItemsWithStore, matchesArchiveContent, prepareArchiveRow } from "../lib/archive-identity.ts";

const item = (overrides = {}) => ({
  id: "content-1",
  theme: "Tech & gadgets",
  kind: "live",
  date: "2026-07-20T08:00:00.000Z",
  title: "Contenu",
  summary: "Résumé",
  source: "Source A",
  url: "https://example.test/article",
  priority: "À lire",
  tags: [],
  ...overrides,
});

function memoryStore() {
  const rows = [];
  return {
    rows,
    upsert: async (incomingRows) => {
      for (const incoming of incomingRows) {
        const existing = rows.find((row) => matchesArchiveContent(row, incoming));
        if (existing) Object.assign(existing, { ...incoming, source_id: existing.source_id });
        else rows.push({ ...incoming });
      }
    },
  };
}

test("ancien puis nouvel ID YouTube conserve un seul enregistrement", async () => {
  const store = memoryStore();
  await archiveItemsWithStore([item({
    id: "youtube-video123-2026-07-20T08:00:00.000Z",
    source: "Jeef — YouTube",
    url: "https://youtu.be/video123",
  })], store.upsert);
  await archiveItemsWithStore([item({
    id: "youtube-video123",
    source: "Jeef — YouTube",
    url: "https://www.youtube.com/watch?v=video123",
  })], store.upsert);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].source_id, "youtube-video123-2026-07-20T08:00:00.000Z");
});

test("deux runs avec le nouvel ID YouTube conservent un seul enregistrement", async () => {
  const store = memoryStore();
  const video = item({ id: "youtube-video123", source: "Jeef — YouTube", url: "https://www.youtube.com/watch?v=video123" });
  await archiveItemsWithStore([video], store.upsert);
  await archiveItemsWithStore([video], store.upsert);
  assert.equal(store.rows.length, 1);
});

test("ancien puis nouvel ID RSS avec même URL et même source conserve un seul enregistrement", async () => {
  const store = memoryStore();
  await archiveItemsWithStore([item({ id: "Source A-0-https://example.test/article" })], store.upsert);
  await archiveItemsWithStore([item({ id: "rss-0123456789abcdef01234567" })], store.upsert);
  assert.equal(store.rows.length, 1);
});

test("deux articles RSS avec des URL différentes restent distincts", async () => {
  const store = memoryStore();
  await archiveItemsWithStore([
    item({ id: "rss-a", url: "https://example.test/a" }),
    item({ id: "rss-b", url: "https://example.test/b" }),
  ], store.upsert);
  assert.equal(store.rows.length, 2);
});

test("la même URL provenant de deux sources différentes n'est pas fusionnée", async () => {
  const store = memoryStore();
  await archiveItemsWithStore([
    item({ id: "rss-a", source: "Source A" }),
    item({ id: "rss-b", source: "Source B" }),
  ], store.upsert);
  assert.equal(store.rows.length, 2);
});

test("un contenu sans équivalent historique est inséré normalement", async () => {
  const store = memoryStore();
  await archiveItemsWithStore([item({ id: "rss-new" })], store.upsert);
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].source_id, "rss-new");
});

test("itemsStored compte les éléments traités et non les insertions physiques", async () => {
  const store = memoryStore();
  const content = item({ id: "rss-stable" });
  assert.equal(await archiveItemsWithStore([content], store.upsert), 1);
  assert.equal(await archiveItemsWithStore([content], store.upsert), 1);
  assert.equal(store.rows.length, 1);
});

test("une ligne RSS prépare explicitement un videoId nullable", () => {
  const row = prepareArchiveRow(item({ id: "rss-stable", source: "Source RSS" }));
  assert.equal(row.youtube_video_id, null);
});

test("une ligne YouTube prépare un videoId textuel", () => {
  const row = prepareArchiveRow(item({
    id: "youtube-video123",
    source: "Jeef — YouTube",
    url: "https://www.youtube.com/watch?v=video123",
  }));
  assert.equal(row.youtube_video_id, "video123");
});
