import { archiveItems, finishCollectionRun, recordSourceRun, registerSources, startCollectionRun } from "@/lib/collection-store";
import { deriveCollectionStatus, summarizeSourceResults } from "@/lib/collection-status";
import type { SourceDefinition, WatchItem, WatchTheme } from "@/lib/watch-types";

type BlizzardEntry = { contentId: string; properties?: { title?: string; category?: string; summary?: string; lastUpdated?: string; publishDate?: string; newsUrl?: string } };
type FranceOffer = { id: string; intitule: string; description?: string; dateCreation?: string; typeContrat?: string; lieuTravail?: { libelle?: string; codePostal?: string }; entreprise?: { nom?: string }; origineOffre?: { urlOrigine?: string } };
type CollectorTask = { source: SourceDefinition; run: () => Promise<WatchItem[]> };

const HTTP_TIMEOUT_MS = 8_000;
const SOURCE_TIMEOUT_MS = 20_000;

const clean = (value = "") => value
  .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();

const between = (input: string, tag: string) => {
  const match = input.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(match?.[1]);
};

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error(`Délai dépassé après ${timeoutMs / 1000} s`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string) {
  const response = await fetchWithTimeout(url, { headers: { "User-Agent": "Vigie-Centrale/1.0" } });
  return response.text();
}

async function withSourceTimeout<T>(operation: Promise<T>, timeoutMs = SOURCE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`Collecteur interrompu après ${timeoutMs / 1000} s`)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseRss(xml: string, source: string, theme: WatchTheme, tags: string[], limit = 5): WatchItem[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, limit).map((match, index) => {
    const item = match[1];
    const link = between(item, "link") || item.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || "";
    const dateRaw = between(item, "pubDate") || between(item, "dc:date") || between(item, "updated");
    const description = between(item, "description") || between(item, "content:encoded");
    return {
      id: `${source}-${index}-${link}`, theme, kind: "live" as const,
      date: dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : new Date().toISOString(),
      title: between(item, "title") || "Nouvelle publication", summary: description.slice(0, 260),
      source, url: link, priority: (theme === "CIP & réglementation" ? "Moyenne" : "À lire") as WatchItem["priority"], tags,
    };
  }).filter((item) => item.url && item.title);
}

function parseYoutube(xml: string, creator: string, theme: WatchTheme, limit = 2): WatchItem[] {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].slice(0, limit).map((match) => {
    const entry = match[1];
    const videoId = between(entry, "yt:videoId");
    const url = entry.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)/i)?.[1]
      || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    const published = between(entry, "published") || between(entry, "updated");
    return {
      id: `youtube-${videoId || creator}-${published}`, theme, kind: "live" as const,
      date: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : new Date().toISOString(),
      title: between(entry, "title") || "Nouvelle vidéo", summary: `Nouvelle vidéo publiée par ${creator}.`,
      source: `${creator} — YouTube`, url, priority: "À lire" as const, tags: ["YouTube", "Créateur", creator],
    };
  }).filter((item) => item.url && item.title);
}

async function blizzard(product: "diablo-4" | "hearthstone", theme: WatchTheme): Promise<WatchItem[]> {
  const data = JSON.parse(await fetchText(`https://news.blizzard.com/api/feed/${product}`));
  return ((data.contentItems || []) as BlizzardEntry[]).slice(0, 6).map((entry) => {
    const p = entry.properties || {};
    const title = clean(p.title);
    const high = /patch|hotfix|season|saison|extension|update|mise à jour|battlegrounds/i.test(`${title} ${p.category || ""}`);
    return {
      id: `blizzard-${entry.contentId}`, theme, kind: "live" as const,
      date: p.lastUpdated || p.publishDate || new Date().toISOString(), title,
      summary: clean(p.summary).slice(0, 260), source: "Blizzard — officiel", url: p.newsUrl || "",
      priority: high ? "Haute" as const : "Moyenne" as const,
      tags: [p.category || "Actualité officielle", product === "diablo-4" ? "Diablo IV" : "Hearthstone"].filter(Boolean),
    };
  }).filter((item) => item.url && item.title);
}

async function franceTravail(): Promise<WatchItem[]> {
  const clientId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Identifiants OAuth France Travail requis");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "api_offresdemploiv2 o2dsoffre" });
  const tokenResponse = await fetchWithTimeout(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire",
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
  );
  const token = (await tokenResponse.json()).access_token;
  if (!token) throw new Error("Jeton OAuth France Travail absent");
  const searches = [
    new URLSearchParams({ departement: "47", range: "0-149", sort: "1" }),
    new URLSearchParams({ commune: "33227", distance: "45", range: "0-149", sort: "1" }),
  ];
  const payloads = await Promise.all(searches.map(async (params) => {
    const response = await fetchWithTimeout(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    return response.json();
  }));
  const uniqueOffers = [...new Map((payloads as { resultats?: FranceOffer[] }[]).flatMap((data) => data.resultats || []).map((offer) => [offer.id, offer])).values()];
  const relevant = uniqueOffers.filter((offer) => /insertion|conseiller.*emploi|accompagnement.*professionnel|référent.*insertion|chargé.*insertion|mission locale|formateur.*insertion|éducateur.*spécialisé|orientation professionnelle/i.test(offer.intitule)).slice(0, 20);
  const checkedAt = new Date().toISOString();
  return relevant.map((offer) => ({
    id: `ft-${offer.id}`, theme: "Emploi" as const, kind: "live" as const, date: offer.dateCreation || checkedAt,
    title: offer.intitule, summary: clean(offer.description).slice(0, 280), source: "France Travail — API officielle",
    url: offer.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    priority: /Marmande|La Réole|Langon/i.test(offer.lieuTravail?.libelle || "") ? "Haute" as const : "Moyenne" as const,
    tags: [offer.lieuTravail?.libelle, offer.typeContrat, offer.entreprise?.nom].filter((tag): tag is string => Boolean(tag)),
  }));
}

const youtubeChannels = [
  { id: "youtube-mathrais", creator: "Mathrais", channelId: "UCkhScOO1FChfqWbE8eR-ZSA", theme: "Hearthstone" as const },
  { id: "youtube-oliech", creator: "Oliech", channelId: "UCTdicWbtwYfLyZ7S1M9XuIQ", theme: "Hearthstone" as const },
  { id: "youtube-shadybunny", creator: "Shadybunny", channelId: "UCb1UDLJOk4n7qZa-Y0z7Yig", theme: "Hearthstone" as const },
  { id: "youtube-jeef", creator: "Jeef", channelId: "UCK3rJ7OXrXZIcnw-xYrSXOg", theme: "Hearthstone" as const },
  { id: "youtube-cliptis", creator: "Cliptis", channelId: "UCTNiHLvyyV1r4-OLb8xaL5g", theme: "Diablo 4" as const },
  { id: "youtube-rob2628", creator: "Rob2628", channelId: "UCLxdlfnTN3G02ekxOwoIzYw", theme: "Diablo 4" as const },
  { id: "youtube-wudijo", creator: "wudijo", channelId: "UCXApYvw59S9MypwdXb1Pe_w", theme: "Diablo 4" as const },
];

export const sourceDefinitions: SourceDefinition[] = [
  { id: "blizzard-diablo-4", name: "Blizzard Diablo IV", theme: "Diablo 4", connectorType: "blizzard", active: true },
  { id: "blizzard-hearthstone", name: "Blizzard Hearthstone", theme: "Hearthstone", connectorType: "blizzard", active: true },
  { id: "rss-ministere-travail", name: "Ministère du Travail", theme: "CIP & réglementation", connectorType: "rss", active: true },
  { id: "rss-unml", name: "Union nationale des Missions Locales", theme: "CIP & réglementation", connectorType: "rss", active: true },
  { id: "rss-google", name: "Google Blog", theme: "Tech & gadgets", connectorType: "rss", active: true },
  { id: "rss-microsoft", name: "Microsoft Blog", theme: "Tech & gadgets", connectorType: "rss", active: true },
  ...youtubeChannels.map((channel) => ({ id: channel.id, name: `YouTube — ${channel.creator}`, theme: channel.theme, connectorType: "youtube" as const, active: true })),
  { id: "france-travail", name: "France Travail", theme: "Emploi", connectorType: "france_travail", active: true },
  { id: "legifrance-piste", name: "Légifrance PISTE", theme: "CIP & réglementation", connectorType: "api", active: false },
];

function createTasks(): CollectorTask[] {
  const get = (id: string) => sourceDefinitions.find((source) => source.id === id)!;
  return [
    { source: get("blizzard-diablo-4"), run: () => blizzard("diablo-4", "Diablo 4") },
    { source: get("blizzard-hearthstone"), run: () => blizzard("hearthstone", "Hearthstone") },
    { source: get("rss-ministere-travail"), run: async () => parseRss(await fetchText("https://travail-emploi.gouv.fr/rss.xml"), "Ministère du Travail", "CIP & réglementation", ["Emploi", "Officiel"], 6) },
    { source: get("rss-unml"), run: async () => parseRss(await fetchText("https://www.unml.info/feed/"), "UNML", "CIP & réglementation", ["Mission Locale", "Réseau"], 5) },
    { source: get("rss-google"), run: async () => parseRss(await fetchText("https://blog.google/rss/"), "Google — blog officiel", "Tech & gadgets", ["Google", "Produit"], 4) },
    { source: get("rss-microsoft"), run: async () => parseRss(await fetchText("https://blogs.microsoft.com/feed/"), "Microsoft — blog officiel", "Tech & gadgets", ["Microsoft", "Produit"], 4) },
    ...youtubeChannels.map((channel) => ({
      source: get(channel.id),
      run: async () => parseYoutube(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`), channel.creator, channel.theme, 2),
    })),
    { source: get("france-travail"), run: franceTravail },
  ];
}

export async function runCollection() {
  await registerSources(sourceDefinitions);
  const tasks = createTasks();
  const runId = await startCollectionRun(tasks.length);
  const results = await Promise.all(tasks.map(async (task) => {
    const startedAt = new Date();
    let ok = false;
    let items: WatchItem[] = [];
    let sourceError: string | undefined;
    try {
      items = await withSourceTimeout(task.run());
      ok = true;
    } catch (error) {
      sourceError = error instanceof Error ? error.message : "Erreur de collecte inconnue";
    }
    const finishedAt = new Date();
    try {
      await recordSourceRun({
        collectionRunId: runId, sourceId: task.source.id,
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
        status: ok ? "completed" : "failed", itemsCollected: ok ? items.length : 0,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: ok ? undefined : sourceError?.slice(0, 500),
      });
      return { ok, journaled: true, items, sourceId: task.source.id };
    } catch (journalError) {
      console.error(`Journalisation impossible pour la source ${task.source.id}`, journalError);
      return { ok, journaled: false, items, sourceId: task.source.id };
    }
  }));
  const items = results.flatMap((result) => result.items).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const { succeeded, failed } = summarizeSourceResults(results);
  const status = deriveCollectionStatus(succeeded, failed);
  const unjournaledSources = results.filter((result) => !result.journaled).map((result) => result.sourceId);
  const journalError = unjournaledSources.length > 0
    ? `Journalisation incomplète pour : ${unjournaledSources.join(", ")}`
    : undefined;
  let stored = 0;
  try {
    stored = await archiveItems(items);
    await finishCollectionRun({ id: runId, status, succeeded, failed, itemsCollected: items.length, itemsStored: stored, errorMessage: journalError });
    return { id: runId, status, collected: items.length, stored, sourceTotal: results.length, sourceSucceeded: succeeded, sourceFailed: failed, warning: journalError };
  } catch (error) {
    const primaryError = error instanceof Error ? error.message : "Erreur de persistance inconnue";
    try {
      await finishCollectionRun({ id: runId, status: "failed", succeeded, failed: Math.max(failed, 1), itemsCollected: items.length, itemsStored: stored, errorMessage: primaryError.slice(0, 500) });
    } catch (finalizationError) {
      const finalMessage = finalizationError instanceof Error ? finalizationError.message : "Erreur inconnue";
      console.error(`Finalisation impossible pour le run ${runId}`, finalizationError);
      throw new Error(`${primaryError}. Finalisation du run impossible : ${finalMessage}`);
    }
    throw error;
  }
}
