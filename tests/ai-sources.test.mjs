import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { aiSourceDefinitions, aiSources, collectAiSource } from "../lib/ai-sources.ts";

const expected = [
  ["openai-news", "rss", "https://openai.com/news/rss.xml", undefined],
  ["github-copilot-changelog", "rss", "https://github.blog/changelog/label/copilot/feed/", undefined],
  ["huggingface-blog", "rss", "https://huggingface.co/blog/feed.xml", undefined],
  ["youtube-ai-explained", "youtube", "https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw", "UCNJ1Ymd5yFuUPtn21xtRbbw"],
  ["youtube-how-i-ai", "youtube", "https://www.youtube.com/feeds/videos.xml?channel_id=UCRYY7IEbkHLH_ScJCu9eWDQ", "UCRYY7IEbkHLH_ScJCu9eWDQ"],
];

const config = (id) => aiSources.find((source) => source.id === id);
const rss = (entries) => `<rss><channel>${entries.join("")}</channel></rss>`;
const rssItem = ({ id, title, description = "", url = `https://example.test/${id}` }) =>
  `<item><guid>${id}</guid><title>${title}</title><description>${description}</description><link>${url}</link><pubDate>2026-07-30T08:00:00Z</pubDate></item>`;
const youtube = (entries) => `<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entries.join("")}</feed>`;
const video = ({ id, title, url = `https://www.youtube.com/watch?v=${id}` }) =>
  `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>2026-07-30T08:00:00Z</published><link rel="alternate" href="${url}"/></entry>`;

test("le registre contient exactement les cinq sources IA vérifiées", () => {
  assert.deepEqual(
    aiSources.map((source) => [source.id, source.connectorType, source.endpoint, source.channelId]),
    expected,
  );
  assert.deepEqual(aiSourceDefinitions(), aiSources.map((source) => ({
    id: source.id, name: source.name, theme: "IA", connectorType: source.connectorType, active: true,
  })));
  assert.equal(aiSources.some((source) => /Tina Huang|Nate Herk|Matt Wolfe/.test(source.name)), false);
});

test("OpenAI conserve une annonce officielle avec sa priorité et ses tags", () => {
  const items = collectAiSource(config("openai-news"), rss([
    rssItem({ id: "openai-1", title: "A major announcement" }),
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0].priority, "Haute");
  assert.ok(items[0].tags.includes("Officiel"));
  assert.ok(items[0].tags.includes("OpenAI"));
});

test("GitHub conserve Copilot et rejette une entrée adjacente sans signal", () => {
  const items = collectAiSource(config("github-copilot-changelog"), rss([
    rssItem({ id: "github-1", title: "Copilot code review agent update" }),
    rssItem({ id: "github-2", title: "GitHub Actions maintenance" }),
  ]));
  assert.deepEqual(items.map((item) => item.title), ["Copilot code review agent update"]);
  assert.equal(items[0].priority, "Haute");
});

test("Hugging Face conserve le technique, rejette la promotion et extrait le lien RSS", () => {
  const items = collectAiSource(config("huggingface-blog"), rss([
    rssItem({ id: "hf-1", title: "New open source model inference", url: "https://huggingface.co/blog/model-inference" }),
    rssItem({ id: "hf-2", title: "Join our community webinar", description: "Register for the event" }),
  ]));
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://huggingface.co/blog/model-inference");
  assert.equal(items[0].priority, "Moyenne");
  assert.ok(items[0].tags.includes("À vérifier"));
});

test("AI Explained conserve une vidéo longue et rejette un Short", () => {
  const items = collectAiSource(config("youtube-ai-explained"), youtube([
    video({ id: "short-1", title: "Short", url: "https://www.youtube.com/shorts/short-1" }),
    video({ id: "long-1", title: "Long analysis" }),
  ]));
  assert.deepEqual(items.map((item) => item.id), ["youtube-long-1"]);
  assert.equal(items[0].priority, "Haute");
  assert.ok(items[0].tags.includes("Analyse"));
  assert.ok(items[0].tags.includes("À vérifier"));
});

test("How I AI applique la fenêtre avant le filtre puis la limite finale", () => {
  const entries = [
    ...Array.from({ length: 10 }, (_, index) => video({ id: `short-${index}`, title: `Short ${index}`, url: `https://www.youtube.com/shorts/short-${index}` })),
    ...Array.from({ length: 6 }, (_, index) => video({ id: `long-${index}`, title: `Workflow ${index}` })),
  ];
  const items = collectAiSource(config("youtube-how-i-ai"), youtube(entries));
  assert.deepEqual(items.map((item) => item.id), ["youtube-long-0", "youtube-long-1", "youtube-long-2", "youtube-long-3", "youtube-long-4"]);
  assert.equal(items[0].priority, "Moyenne");
  assert.ok(items[0].tags.includes("Guide"));
  assert.ok(items[0].tags.includes("Workflow"));
  assert.ok(items[0].tags.includes("À vérifier"));
});

test("les collecteurs historiques restent en place et les ajouts viennent du registre IA", async () => {
  const collector = await readFile(new URL("../lib/collector.ts", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const historicalIds = ["blizzard-diablo-4", "blizzard-hearthstone", "rss-ministere-travail", "rss-unml", "rss-google", "rss-microsoft", "france-travail", "legifrance-piste"];
  for (const id of historicalIds) assert.ok(collector.includes(`"${id}"`), id);
  assert.match(collector, /\.\.\.aiSourceDefinitions\(\)/);
  assert.match(collector, /\.\.\.aiSources\.map/);
  assert.match(collector, /run: async \(\) => publishAll\(collectAiSource\(source,/);
  assert.equal(aiSourceDefinitions().length, 5);
  assert.deepEqual(vercel.crons, [{ path: "/api/cron/archive", schedule: "15 9 * * *" }]);
});
