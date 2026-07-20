import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { CollectorDiagnosticError } from "./http-client.ts";
import type { WatchItem, WatchTheme } from "./watch-types.ts";

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: true,
  processEntities: false,
});

const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const node = (value: unknown): XmlNode => value && typeof value === "object" ? value as XmlNode : {};
const text = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const content = node(value)["#text"];
  return typeof content === "string" || typeof content === "number" ? String(content).trim() : "";
};
const clean = (value = "") => value
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, " ").trim();
const stableId = (namespace: string, identity: string) => `${namespace}-${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;

function parse(xml: string, label: string) {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new CollectorDiagnosticError(`${label} invalide`, "parsing");
  try {
    return node(parser.parse(xml));
  } catch {
    throw new CollectorDiagnosticError(`${label} invalide`, "parsing");
  }
}

function linkFrom(value: unknown) {
  if (typeof value === "string") return value.trim();
  const links = array(value as XmlNode | XmlNode[] | undefined).map(node);
  const preferred = links.find((link) => !link["@rel"] || text(link["@rel"]) === "alternate") || links[0];
  return text(preferred?.["@href"]) || text(preferred);
}

function dateOrNow(value: string, now: () => Date) {
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : now().toISOString();
}

export function parseRssFeed(
  xml: string,
  source: string,
  theme: WatchTheme,
  tags: string[],
  limit = 5,
  now = () => new Date(),
): WatchItem[] {
  const document = parse(xml, "Flux RSS");
  const rssChannel = node(node(document.rss).channel);
  const rdf = node(document["rdf:RDF"] || document.RDF);
  const atom = node(document.feed);
  const entries = array((rssChannel.item || rdf.item || atom.entry) as XmlNode | XmlNode[] | undefined).slice(0, limit);

  return entries.map(node).map((entry) => {
    const link = linkFrom(entry.link);
    const date = text(entry.pubDate) || text(entry["dc:date"]) || text(entry.updated) || text(entry.published);
    const title = clean(text(entry.title)) || "Nouvelle publication";
    const description = clean(text(entry.description) || text(entry["content:encoded"]) || text(entry.summary) || text(entry.content));
    const identity = text(entry.guid) || text(entry.id) || link || `${title}|${date}`;
    return {
      id: stableId("rss", `${source}|${identity}`), theme, kind: "live" as const,
      date: dateOrNow(date, now), title, summary: description.slice(0, 260), source, url: link,
      priority: (theme === "CIP & réglementation" ? "Moyenne" : "À lire") as WatchItem["priority"], tags,
    };
  }).filter((item) => item.url && item.title);
}

export function parseYoutubeFeed(
  xml: string,
  creator: string,
  theme: WatchTheme,
  limit = 2,
  now = () => new Date(),
): WatchItem[] {
  const document = parse(xml, "Flux YouTube");
  const entries = array(node(document.feed).entry as XmlNode | XmlNode[] | undefined).slice(0, limit);
  return entries.map(node).map((entry) => {
    const videoId = text(entry["yt:videoId"]);
    const link = linkFrom(entry.link) || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : "");
    const published = text(entry.published) || text(entry.updated);
    return {
      id: videoId ? `youtube-${videoId}` : stableId("youtube", `${creator}|${link}`),
      theme, kind: "live" as const, date: dateOrNow(published, now),
      title: clean(text(entry.title)) || "Nouvelle vidéo",
      summary: `Nouvelle vidéo publiée par ${creator}.`, source: `${creator} — YouTube`, url: link,
      priority: "À lire" as const, tags: ["YouTube", "Créateur", creator],
    };
  }).filter((item) => item.url && item.title);
}
