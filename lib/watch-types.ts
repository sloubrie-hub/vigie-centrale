export type WatchTheme = "Diablo 4" | "Hearthstone" | "Emploi" | "CIP & réglementation" | "Tech & gadgets";

export type WatchItem = {
  id: string;
  theme: WatchTheme;
  kind: "live";
  date: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  priority: "Haute" | "Moyenne" | "À lire";
  tags: string[];
  archivedAt?: string;
};

export type SourceDefinition = {
  id: string;
  name: string;
  theme: WatchTheme | null;
  connectorType: "blizzard" | "rss" | "youtube" | "france_travail" | "api";
  active: boolean;
};

export type CollectionStatus = "running" | "completed" | "partial" | "failed";
export type SourceRunStatus = "running" | "completed" | "failed";

export type SourceHealth = {
  id: string;
  source: string;
  status: "live" | "api" | "error" | "running";
  count: number;
  detail: string;
  checkedAt: string | null;
  durationMs: number | null;
};

export type CollectionSummary = {
  id: string;
  status: CollectionStatus;
  startedAt: string;
  finishedAt: string | null;
  sourceTotal: number;
  sourceSucceeded: number;
  sourceFailed: number;
  itemsCollected: number;
  itemsStored: number;
} | null;
