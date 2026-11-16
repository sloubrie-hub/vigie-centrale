import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import {
  cacheHubYoutubeExport, createYoutubeTasks, inspectHubYoutubeCoverage, readYoutubeCoverage, youtubeChannels,
} from "../lib/youtube-collection.ts";

test("le lot signé est relu en cache et le mode observation garde la référence Atom", async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const env = {
    VERCEL_ENV: "production",
    VIGIE_HUB_EXPORT_PUBLIC_KEY: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    VIGIE_HUB_REUSE: "true",
    VIGIE_HUB_OBSERVE: "true",
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-16T09:15:00Z") });

  const channels = new Map(youtubeChannels.map((channel, index) => [channel.channelId, {
    ...channel,
    items: [0, 1].map((offset) => ({
      channel_id: channel.channelId, id: `F${String(index * 10 + offset).padStart(10, "0")}`,
      title: `Vidéo de recette ${index}-${offset}`, published_at: "2026-11-15T17:00:00Z",
      expires_at: "2026-12-14T02:00:00Z", checked_in_run: 1,
    })),
  }]));
  const lot = {
    purpose: "vigie-youtube-v1", run_id: "nuit-verifiee", finished_at: "2026-11-16T02:00:00Z",
    items: [...channels.values()].filter(({ theme }) => theme === "Hearthstone").flatMap(({ items }) => items),
  };
  const seal = (batch) => {
    const payload = JSON.stringify(batch);
    return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString("base64") };
  };
  const delivered = seal({ ...lot, delivery: "nightly" });
  assert.equal(await cacheHubYoutubeExport(seal(lot), true), null);
  assert.equal(await cacheHubYoutubeExport({ ...delivered, payload: delivered.payload + " " }, true), null);
  assert.equal((await cacheHubYoutubeExport(delivered, true)).run_id, lot.run_id);
  const replay = seal({ ...lot, delivery: "nightly", finished_at: "2026-11-16T01:58:00Z", items: [] });
  assert.equal((await cacheHubYoutubeExport(replay, true)).finished_at, lot.finished_at);

  const atomRequests = [];
  let late = false;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    assert.equal(url.origin + url.pathname, "https://www.youtube.com/feeds/videos.xml");
    const channel = channels.get(url.searchParams.get("channel_id"));
    assert.ok(channel);
    atomRequests.push(channel.id);
    const items = late && channel.id === "youtube-oliech"
      ? [{ id: "LATE0000001", title: "Publication de la matinée", published_at: "2026-11-16T08:00:00Z" }, ...channel.items]
      : channel.items;
    const entries = items.map((item) => `<entry><yt:videoId>${item.id}</yt:videoId><title>${item.title}</title><published>${item.published_at}</published></entry>`).join("");
    return new Response(`<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015">${entries}</feed>`);
  });
  const collect = () => Promise.all(createYoutubeTasks((id) => ({ id })).map((task) => task.run("collecte-reference")));
  const first = await collect();
  assert.equal(atomRequests.length, 7);
  assert.equal(first.flatMap(({ items }) => items).length, 14);
  const proof = await readYoutubeCoverage();
  assert.equal(proof.length, 4);
  assert.ok(proof.every((row) => row.collectionRunId === "collecte-reference" && row.equivalent));

  late = true;
  const check = await inspectHubYoutubeCoverage();
  assert.equal(check.batch.id, lot.run_id);
  assert.deepEqual(check.channels.filter(({ equivalent }) => !equivalent).map(({ source }) => source), ["youtube-oliech"]);
  assert.equal(check.channels.find(({ source }) => source === "youtube-oliech").publishedAfterHub, 1);

  delete process.env.VIGIE_HUB_OBSERVE;
  late = false;
  atomRequests.length = 0;
  await collect();
  assert.deepEqual(atomRequests.sort(), ["youtube-cliptis", "youtube-rob2628", "youtube-wudijo"]);

  t.mock.timers.setTime(Date.parse("2026-11-16T14:05:00Z"));
  assert.equal(await cacheHubYoutubeExport(delivered, true), null);
  atomRequests.length = 0;
  await collect();
  assert.equal(atomRequests.length, 7);
});
