import { parseRssFeed, parseYoutubeFeed } from "./xml-feeds.ts";
import type { SourceDefinition, WatchItem } from "./watch-types.ts";

type AiSourceConfig = {
  id: string;
  name: string;
  connectorType: "rss" | "youtube";
  endpoint: string;
  channelId?: string;
  creator?: string;
  role: "official" | "critical" | "guide";
  policy: "auto" | "review";
  parseWindow: number;
  finalLimit: number;
  priority: WatchItem["priority"];
  tags: string[];
  includePatterns?: RegExp[];
  excludeShorts?: boolean;
};

export const aiSources: AiSourceConfig[] = [
  {
    id: "openai-news",
    name: "OpenAI News",
    connectorType: "rss",
    endpoint: "https://openai.com/news/rss.xml",
    role: "official",
    policy: "auto",
    parseWindow: 20,
    finalLimit: 10,
    priority: "Haute",
    tags: ["IA", "Officiel", "OpenAI"],
  },
  {
    id: "github-copilot-changelog",
    name: "GitHub Changelog — Copilot",
    connectorType: "rss",
    endpoint: "https://github.blog/changelog/label/copilot/feed/",
    role: "official",
    policy: "auto",
    parseWindow: 20,
    finalLimit: 10,
    priority: "Haute",
    tags: ["IA", "Officiel", "GitHub Copilot", "Développement"],
    includePatterns: [/copilot/i, /coding agent/i, /agent skills?/i, /\bmcp\b/i, /ai-assisted development/i, /code review agent/i],
  },
  {
    id: "huggingface-blog",
    name: "Hugging Face Blog",
    connectorType: "rss",
    endpoint: "https://huggingface.co/blog/feed.xml",
    role: "official",
    policy: "review",
    parseWindow: 20,
    finalLimit: 8,
    priority: "Moyenne",
    tags: ["IA", "Hugging Face", "Open source", "À vérifier"],
    includePatterns: [/\bmodels?\b/i, /inference/i, /transformers?/i, /diffusers?/i, /datasets?/i, /agents?/i, /benchmarks?/i, /releases?/i, /open source/i, /\bgpu\b/i, /encoders?/i],
  },
  {
    id: "youtube-ai-explained",
    name: "YouTube — AI Explained",
    connectorType: "youtube",
    channelId: "UCNJ1Ymd5yFuUPtn21xtRbbw",
    endpoint: "https://www.youtube.com/feeds/videos.xml?channel_id=UCNJ1Ymd5yFuUPtn21xtRbbw",
    creator: "AI Explained",
    role: "critical",
    policy: "review",
    parseWindow: 15,
    finalLimit: 4,
    priority: "Haute",
    tags: ["IA", "YouTube", "Analyse", "À vérifier", "AI Explained"],
    excludeShorts: true,
  },
  {
    id: "youtube-how-i-ai",
    name: "YouTube — How I AI",
    connectorType: "youtube",
    channelId: "UCRYY7IEbkHLH_ScJCu9eWDQ",
    endpoint: "https://www.youtube.com/feeds/videos.xml?channel_id=UCRYY7IEbkHLH_ScJCu9eWDQ",
    creator: "How I AI",
    role: "guide",
    policy: "review",
    parseWindow: 15,
    finalLimit: 5,
    priority: "Moyenne",
    tags: ["IA", "YouTube", "Guide", "Workflow", "À vérifier", "How I AI"],
    excludeShorts: true,
  },
];

export function aiSourceDefinitions(): SourceDefinition[] {
  return aiSources.map((source) => ({
    id: source.id,
    name: source.name,
    theme: "IA",
    connectorType: source.connectorType,
    active: true,
  }));
}

function isShort(item: WatchItem) {
  try {
    return new URL(item.url).pathname.startsWith("/shorts/");
  } catch {
    return false;
  }
}

export function applyAiSourcePolicy(source: AiSourceConfig, items: WatchItem[]): WatchItem[] {
  return items
    .filter((item) => !source.excludeShorts || !isShort(item))
    .filter((item) => {
      if (!source.includePatterns) return true;
      const searchable = `${item.title} ${item.summary} ${item.url}`.toLowerCase();
      return source.includePatterns.some((pattern) => pattern.test(searchable));
    })
    .map((item) => ({
      ...item,
      priority: source.priority,
      tags: [...new Set([...item.tags, ...source.tags])],
    }))
    .slice(0, source.finalLimit);
}

export function collectAiSource(source: AiSourceConfig, xml: string): WatchItem[] {
  const parsed = source.connectorType === "rss"
    ? parseRssFeed(xml, source.name, "IA", source.tags, source.parseWindow)
    : parseYoutubeFeed(xml, source.creator || source.name, "IA", source.parseWindow);
  return applyAiSourcePolicy(source, parsed);
}
