import { archiveItems } from "@/lib/archive";

type WatchItem = {
  id: string;
  theme: "Diablo 4" | "Hearthstone" | "Emploi" | "CIP & réglementation" | "Tech & gadgets";
  kind: "live";
  date: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  priority: "Haute" | "Moyenne" | "À lire";
  tags: string[];
};

type SourceState = { source: string; status: "live" | "api" | "error"; count: number; detail: string; checkedAt: string };
type BlizzardEntry = { contentId: string; properties?: { title?: string; category?: string; summary?: string; lastUpdated?: string; publishDate?: string; newsUrl?: string } };
type FranceOffer = { id: string; intitule: string; description?: string; dateCreation?: string; typeContrat?: string; lieuTravail?: { libelle?: string; codePostal?: string }; entreprise?: { nom?: string }; origineOffre?: { urlOrigine?: string } };

const clean = (value = "") => value
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, " ")
  .trim();

const between = (input: string, tag: string) => {
  const match = input.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return clean(match?.[1]);
};

async function fetchText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Vigie-Centrale/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}

function parseRss(xml: string, source: string, theme: WatchItem["theme"], tags: string[], limit = 5): WatchItem[] {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, limit).map((match, index) => {
    const item = match[1];
    const link = between(item, "link") || item.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || "";
    const dateRaw = between(item, "pubDate") || between(item, "dc:date") || between(item, "updated");
    const description = between(item, "description") || between(item, "content:encoded");
    return {
      id: `${source}-${index}-${link}`,
      theme, kind: "live" as const, date: dateRaw && !Number.isNaN(Date.parse(dateRaw)) ? new Date(dateRaw).toISOString() : new Date().toISOString(),
      title: between(item, "title") || "Nouvelle publication", summary: description.slice(0, 260), source, url: link,
      priority: (theme === "CIP & réglementation" ? "Moyenne" : "À lire") as WatchItem["priority"], tags,
    };
  }).filter((item) => item.url && item.title);
}

function parseYoutube(xml: string, creator: string, theme: WatchItem["theme"], limit = 2): WatchItem[] {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].slice(0, limit).map((match) => {
    const entry = match[1];
    const videoId = between(entry, "yt:videoId");
    const url = entry.match(/<link[^>]+rel=["']alternate["'][^>]+href=["']([^"']+)/i)?.[1]
      || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    const published = between(entry, "published") || between(entry, "updated");
    return {
      id: `youtube-${videoId || creator}-${published}`,
      theme, kind: "live" as const, date: published && !Number.isNaN(Date.parse(published)) ? new Date(published).toISOString() : new Date().toISOString(),
      title: between(entry, "title") || "Nouvelle vidéo", summary: `Nouvelle vidéo publiée par ${creator}.`,
      source: `${creator} — YouTube`, url, priority: "À lire" as const, tags: ["YouTube", "Créateur", creator],
    };
  }).filter((item) => item.url && item.title);
}

async function blizzard(product: "diablo-4" | "hearthstone", theme: WatchItem["theme"]): Promise<WatchItem[]> {
  const raw = await fetchText(`https://news.blizzard.com/api/feed/${product}`);
  const data = JSON.parse(raw);
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
  }).filter((item: WatchItem) => item.url && item.title);
}

async function franceTravail(): Promise<{ items: WatchItem[]; state: SourceState }> {
  const clientId = process.env.FRANCE_TRAVAIL_CLIENT_ID;
  const clientSecret = process.env.FRANCE_TRAVAIL_CLIENT_SECRET;
  const checkedAt = new Date().toISOString();
  if (!clientId || !clientSecret) return { items: [], state: { source: "France Travail", status: "api", count: 0, detail: "Identifiants OAuth requis", checkedAt } };
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "api_offresdemploiv2 o2dsoffre" });
  const tokenResponse = await fetch("https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!tokenResponse.ok) {
    const detail = tokenResponse.status === 401
      ? "Identifiants OAuth refusés"
      : tokenResponse.status === 403
        ? "API Offres d’emploi non autorisée pour cette application"
        : tokenResponse.status === 400
          ? "Droits ou périmètre OAuth invalides"
          : `Service OAuth indisponible (HTTP ${tokenResponse.status})`;
    throw new Error(detail);
  }
  const token = (await tokenResponse.json()).access_token;
  const searches = [
    new URLSearchParams({ departement: "47", range: "0-149", sort: "1" }),
    new URLSearchParams({ commune: "33227", distance: "45", range: "0-149", sort: "1" }),
  ];
  const responses = await Promise.all(searches.map((params) => fetch(`https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })));
  if (responses.some((response) => !response.ok)) throw new Error(`API France Travail ${responses.find((response) => !response.ok)?.status}`);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const allOffers = payloads.flatMap((data) => (data.resultats || []) as FranceOffer[]);
  const uniqueOffers = [...new Map(allOffers.map((offer) => [offer.id, offer])).values()];
  const relevant = uniqueOffers.filter((offer) => /insertion|conseiller.*emploi|accompagnement.*professionnel|référent.*insertion|chargé.*insertion|mission locale|formateur.*insertion|éducateur.*spécialisé|orientation professionnelle/i.test(offer.intitule)).slice(0, 20);
  const items = relevant.map((offer) => ({
    id: `ft-${offer.id}`, theme: "Emploi" as const, kind: "live" as const, date: offer.dateCreation || checkedAt,
    title: offer.intitule, summary: clean(offer.description).slice(0, 280), source: "France Travail — API officielle",
    url: offer.origineOffre?.urlOrigine || `https://candidat.francetravail.fr/offres/recherche/detail/${offer.id}`,
    priority: /Marmande|La Réole|Langon/i.test(offer.lieuTravail?.libelle || "") ? "Haute" as const : "Moyenne" as const,
    tags: [offer.lieuTravail?.libelle, offer.typeContrat, offer.entreprise?.nom].filter((tag): tag is string => Boolean(tag)),
  }));
  return { items, state: { source: "France Travail", status: "live", count: items.length, detail: "API officielle — Lot-et-Garonne et secteur de Langon", checkedAt } };
}

export async function GET() {
  const checkedAt = new Date().toISOString();
  const youtubeChannels: { creator: string; channelId: string; theme: WatchItem["theme"] }[] = [
    { creator: "Mathrais", channelId: "UCkhScOO1FChfqWbE8eR-ZSA", theme: "Hearthstone" },
    { creator: "Oliech", channelId: "UCTdicWbtwYfLyZ7S1M9XuIQ", theme: "Hearthstone" },
    { creator: "Shadybunny", channelId: "UCb1UDLJOk4n7qZa-Y0z7Yig", theme: "Hearthstone" },
    { creator: "Jeef", channelId: "UCK3rJ7OXrXZIcnw-xYrSXOg", theme: "Hearthstone" },
    { creator: "Cliptis", channelId: "UCTNiHLvyyV1r4-OLb8xaL5g", theme: "Diablo 4" },
    { creator: "Rob2628", channelId: "UCLxdlfnTN3G02ekxOwoIzYw", theme: "Diablo 4" },
    { creator: "wudijo", channelId: "UCXApYvw59S9MypwdXb1Pe_w", theme: "Diablo 4" },
  ];
  const tasks = [
    { source: "Blizzard Diablo IV", run: () => blizzard("diablo-4", "Diablo 4") },
    { source: "Blizzard Hearthstone", run: () => blizzard("hearthstone", "Hearthstone") },
    { source: "Ministère du Travail", run: async () => parseRss(await fetchText("https://travail-emploi.gouv.fr/rss.xml"), "Ministère du Travail", "CIP & réglementation", ["Emploi", "Officiel"], 6) },
    { source: "Union nationale des Missions Locales", run: async () => parseRss(await fetchText("https://www.unml.info/feed/"), "UNML", "CIP & réglementation", ["Mission Locale", "Réseau"], 5) },
    { source: "Google Blog", run: async () => parseRss(await fetchText("https://blog.google/rss/"), "Google — blog officiel", "Tech & gadgets", ["Google", "Produit"], 4) },
    { source: "Microsoft Blog", run: async () => parseRss(await fetchText("https://blogs.microsoft.com/feed/"), "Microsoft — blog officiel", "Tech & gadgets", ["Microsoft", "Produit"], 4) },
    ...youtubeChannels.map((channel) => ({
      source: `YouTube — ${channel.creator}`,
      run: async () => parseYoutube(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`), channel.creator, channel.theme, 2),
    })),
  ];
  const settled = await Promise.allSettled(tasks.map((task) => task.run()));
  const items: WatchItem[] = [];
  const sources: SourceState[] = settled.map((result, index) => {
    if (result.status === "fulfilled") { items.push(...result.value); return { source: tasks[index].source, status: "live", count: result.value.length, detail: "Source publique connectée", checkedAt }; }
    return { source: tasks[index].source, status: "error", count: 0, detail: "Source temporairement indisponible", checkedAt };
  });
  try { const ft = await franceTravail(); items.push(...ft.items); sources.push(ft.state); }
  catch (error) { sources.push({ source: "France Travail", status: "error", count: 0, detail: error instanceof Error ? error.message : "Connexion API en échec", checkedAt }); }
  sources.push({ source: "Légifrance PISTE", status: "api", count: 0, detail: "Identifiants API requis avant activation", checkedAt });
  items.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  let archive = { enabled: false, stored: 0 };
  try { archive = await archiveItems(items); }
  catch { sources.push({ source: "Archives PostgreSQL", status: "error", count: 0, detail: "Archivage temporairement indisponible", checkedAt }); }
  return Response.json({ items, sources, checkedAt, archive }, { headers: { "Cache-Control": "public, max-age=300, stale-while-revalidate=900" } });
}
