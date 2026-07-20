import assert from "node:assert/strict";
import test from "node:test";
import { parseRssFeed, parseYoutubeFeed } from "../lib/xml-feeds.ts";

const now = () => new Date("2026-07-20T10:00:00.000Z");

test("un XML réellement invalide produit une erreur explicite", () => {
  assert.throws(
    () => parseRssFeed("<rss><channel>", "Test", "Tech & gadgets", [], 5, now),
    /Flux RSS invalide/,
  );
});

test("un flux RSS valide vide est un succès à zéro élément", () => {
  const items = parseRssFeed("<?xml version=\"1.0\"?><rss><channel><title>Vide</title></channel></rss>", "Test", "Tech & gadgets", [], 5, now);
  assert.deepEqual(items, []);
});

test("un élément RSS incomplet n'empêche pas les autres d'être lus", () => {
  const xml = `<rss><channel>
    <item><title>Sans lien</title></item>
    <item><guid>stable-1</guid><title>Valide</title><link>https://example.test/1</link><pubDate>2026-07-20T08:00:00Z</pubDate></item>
  </channel></rss>`;
  const items = parseRssFeed(xml, "Test", "Tech & gadgets", [], 5, now);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Valide");
});

test("les identifiants RSS restent stables lorsque l'ordre change", () => {
  const itemA = "<item><guid>a</guid><title>A</title><link>https://example.test/a</link></item>";
  const itemB = "<item><guid>b</guid><title>B</title><link>https://example.test/b</link></item>";
  const first = parseRssFeed(`<rss><channel>${itemA}${itemB}</channel></rss>`, "Test", "Tech & gadgets", [], 5, now);
  const second = parseRssFeed(`<rss><channel>${itemB}${itemA}</channel></rss>`, "Test", "Tech & gadgets", [], 5, now);
  assert.deepEqual(
    Object.fromEntries(first.map((item) => [item.url, item.id])),
    Object.fromEntries(second.map((item) => [item.url, item.id])),
  );
});

test("un flux YouTube Atom vide est un succès à zéro élément", () => {
  assert.deepEqual(parseYoutubeFeed("<feed xmlns=\"http://www.w3.org/2005/Atom\"></feed>", "Créateur", "Diablo 4", 2, now), []);
});

test("YouTube utilise l'identifiant vidéo stable", () => {
  const xml = `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">
    <entry><yt:videoId>video-123</yt:videoId><title>Vidéo</title><published>2026-07-20T08:00:00Z</published><link rel="alternate" href="https://youtube.test/watch?v=video-123"/></entry>
  </feed>`;
  const [item] = parseYoutubeFeed(xml, "Créateur", "Diablo 4", 2, now);
  assert.equal(item.id, "youtube-video-123");
});
