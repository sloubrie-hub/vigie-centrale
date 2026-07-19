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
export type SourceRunStatus = "completed" | "failed";
export type SourceHealthStatus = "healthy" | "degraded" | "error" | "inactive";

export type SourceHealth = {
  id: string;
  source: string;
  theme: WatchTheme | null;
  connectorType: SourceDefinition["connectorType"];
  active: boolean;
  status: SourceHealthStatus;
  count: number;
  detail: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: SourceRunStatus | null;
  consecutiveFailures: number;
  successRate: number | null;
  durationMs: number | null;
  recentError: string | null;
  lastCollectionRunId: string | null;
};

export type DataReliability = {
  status: "reliable" | "degraded" | "unusable" | "pending" | "unknown";
  analysisReady: boolean;
  reasons: string[];
};

export type ReliabilitySummary = {
  global: DataReliability;
  employment: DataReliability;
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
  errorMessage: string | null;
} | null;
