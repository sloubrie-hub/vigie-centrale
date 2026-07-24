import { archiveItems, finishCollectionRun, recordSourceRun, registerSources, startCollectionRun } from "@/lib/collection-store";
import { executeCollectorTasks, type CollectorTask } from "@/lib/collector-runner";
import { deriveCollectionStatus, summarizeSourceResults } from "@/lib/collection-status";
import { CollectorDiagnosticError, requestJson, requestText } from "@/lib/http-client";
import {
  createFranceTravailSearches,
  franceTravailOfferUrl,
  persistFranceTravailOffers,
  selectRelevantFranceTravailOffers,
  type FranceTravailOffer,
} from "@/lib/france-travail-job-offer";
import { upsertJobOfferFromSource } from "@/lib/job-offer-store";
import { parseRssFeed, parseYoutubeFeed } from "@/lib/xml-feeds";
import type { SourceDefinition, WatchItem, WatchTheme } from "@/lib/watch-types";

type BlizzardEntry = { contentId: string; properties?: { title?: string; category?: string; summary?: string; lastUpdated?: string; publishDate?: string; newsUrl?: string } };

const clean = (value = "") => value
  .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();

async function blizzard(product: "diablo-4" | "hearthstone", theme: WatchTheme): Promise<WatchItem[]> {
  const label = `Blizzard ${product === "diablo-4" ? "Diablo IV" : "Hearthstone"}`;
  const data = await requestJson<{ contentItems?: unknown }>(`https://news.blizzard.com/api/feed/${product}`, {
    label,
    headers: { "User-Agent": "Vigie-Centrale/1.0", Accept: "application/json" },
  });
  if (!data || !Array.isArray(data.contentItems)) {
    throw new CollectorDiagnosticError(`${label} : réponse JSON inattendue`, "invalid_response");
  }
  const entries = (data.contentItems as BlizzardEntry[]).filter((entry) => typeof entry?.contentId === "string");
  if (data.contentItems.length > 0 && entries.length === 0) {
    throw new CollectorDiagnosticError(`${label} : contenu JSON invalide`, "invalid_response");
  }
  return entries.slice(0, 6).map((entry) => {
    const p = entry.properties || {};
    const title = clean(p.title);
    const high = /patch|hotfix|season|saison|extension|update|mise à jour|battlegrounds/i.test(`${title} ${p.category || ""}`);
    return {
      id: `blizzard-${entry.contentId}`, theme, kind: "live" as const,
      date: [p.lastUpdated, p.publishDate].find((date) => date && !Number.isNaN(Date.parse(date))) || new Date().toISOString(), title,
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
  const tokenPayload = await requestJson<{ access_token?: unknown }>(
    "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire",
    { label: "OAuth France Travail", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body },
  );
  const token = tokenPayload?.access_token;
  if (typeof token !== "string" || !token.trim()) {
    throw new CollectorDiagnosticError("OAuth France Travail : jeton absent ou invalide", "invalid_response");
  }
  const searches = createFranceTravailSearches();
  const payloads = await Promise.all(searches.map(async (params) => {
    const payload = await requestJson<{ resultats?: unknown }>(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, {
      label: "API France Travail",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      allowEmpty: true,
    });
    if (payload === null) return { resultats: [] as FranceTravailOffer[] };
    if (!Array.isArray(payload.resultats)) {
      throw new CollectorDiagnosticError("API France Travail : réponse JSON inattendue", "invalid_response");
    }
    const invalidOffer = payload.resultats.some((offer) => !offer || typeof offer !== "object"
      || typeof (offer as FranceTravailOffer).id !== "string" || typeof (offer as FranceTravailOffer).intitule !== "string");
    if (invalidOffer) throw new CollectorDiagnosticError("API France Travail : offre invalide dans la réponse", "invalid_response");
    return { resultats: payload.resultats as FranceTravailOffer[] };
  }));
  const relevant = selectRelevantFranceTravailOffers(payloads);
  const checkedAt = new Date().toISOString();
  await persistFranceTravailOffers(relevant, checkedAt, upsertJobOfferFromSource);
  return relevant.map((offer) => ({
    id: `ft-${offer.id}`, theme: "Emploi" as const, kind: "live" as const, date: offer.dateCreation || checkedAt,
    title: offer.intitule, summary: clean(offer.description).slice(0, 280), source: "France Travail — API officielle",
    url: franceTravailOfferUrl(offer),
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
    { source: get("rss-ministere-travail"), run: async () => parseRssFeed((await requestText("https://travail-emploi.gouv.fr/rss.xml", { label: "RSS Ministère du Travail", headers: { "User-Agent": "Vigie-Centrale/1.0" } })).text, "Ministère du Travail", "CIP & réglementation", ["Emploi", "Officiel"], 6) },
    { source: get("rss-unml"), run: async () => parseRssFeed((await requestText("https://www.unml.info/feed/", { label: "RSS UNML", headers: { "User-Agent": "Vigie-Centrale/1.0" } })).text, "UNML", "CIP & réglementation", ["Mission Locale", "Réseau"], 5) },
    { source: get("rss-google"), run: async () => parseRssFeed((await requestText("https://blog.google/rss/", { label: "RSS Google", headers: { "User-Agent": "Vigie-Centrale/1.0" } })).text, "Google — blog officiel", "Tech & gadgets", ["Google", "Produit"], 4) },
    { source: get("rss-microsoft"), run: async () => parseRssFeed((await requestText("https://blogs.microsoft.com/feed/", { label: "RSS Microsoft", headers: { "User-Agent": "Vigie-Centrale/1.0" } })).text, "Microsoft — blog officiel", "Tech & gadgets", ["Microsoft", "Produit"], 4) },
    ...youtubeChannels.map((channel) => ({
      source: get(channel.id),
      run: async () => parseYoutubeFeed((await requestText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`, { label: `YouTube ${channel.creator}`, headers: { "User-Agent": "Vigie-Centrale/1.0" } })).text, channel.creator, channel.theme, 2),
    })),
    { source: get("france-travail"), run: franceTravail },
  ];
}

export async function runCollection() {
  await registerSources(sourceDefinitions);
  const tasks = createTasks();
  const runId = await startCollectionRun(tasks.length);
  const results = await executeCollectorTasks(tasks, runId, recordSourceRun);
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
