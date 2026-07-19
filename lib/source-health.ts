import type {
  CollectionSummary,
  DataReliability,
  SourceDefinition,
  SourceHealth,
  SourceRunStatus,
} from "./watch-types.ts";

export const HEALTH_WINDOW_SIZE = 10;

export type SourceRunObservation = {
  status: SourceRunStatus;
  startedAt: string;
  finishedAt: string;
  itemsCollected: number;
  durationMs: number;
  errorMessage: string | null;
};

export function calculateSourceHealth(
  source: SourceDefinition,
  observations: SourceRunObservation[],
  lastSuccessAt: string | null = null,
  lastKnownError: string | null = null,
): SourceHealth {
  const recent = [...observations]
    .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
    .slice(0, HEALTH_WINDOW_SIZE);
  const latest = recent[0];
  const consecutiveFailures = recent.findIndex((run) => run.status === "completed") === -1
    ? recent.filter((run) => run.status === "failed").length
    : recent.findIndex((run) => run.status === "completed");
  const successes = recent.filter((run) => run.status === "completed").length;
  const successRate = recent.length > 0 ? Math.round((successes / recent.length) * 100) : null;
  const knownSuccess = lastSuccessAt || recent.find((run) => run.status === "completed")?.finishedAt || null;
  const recentError = recent.find((run) => run.errorMessage)?.errorMessage || lastKnownError;

  let status: SourceHealth["status"];
  let detail: string;
  if (!source.active) {
    status = "inactive";
    detail = "Source désactivée volontairement";
  } else if (!latest) {
    status = "degraded";
    detail = "Aucune collecte connue";
  } else if (latest.status === "failed" && (!knownSuccess || consecutiveFailures >= 2)) {
    status = "error";
    detail = consecutiveFailures >= 2
      ? `${consecutiveFailures} échecs consécutifs`
      : "Aucun succès connu";
  } else if (latest.status === "failed") {
    status = "degraded";
    detail = "Échec ponctuel après un succès";
  } else if (successRate !== null && successRate < 80) {
    status = "degraded";
    detail = `Taux de succès récent : ${successRate} %`;
  } else {
    status = "healthy";
    detail = "Collectes récentes réussies";
  }

  return {
    id: source.id,
    source: source.name,
    theme: source.theme,
    connectorType: source.connectorType,
    active: source.active,
    status,
    count: latest?.itemsCollected || 0,
    detail,
    lastAttemptAt: latest?.finishedAt || null,
    lastSuccessAt: knownSuccess,
    lastStatus: latest?.status || null,
    consecutiveFailures,
    successRate,
    durationMs: latest?.durationMs ?? null,
    recentError,
  };
}

export function assessDataReliability(
  collection: CollectionSummary,
  sources: SourceHealth[],
  requiredSourceIds?: string[],
): DataReliability {
  if (!collection) return { status: "unknown", analysisReady: false, reasons: ["Aucune collecte connue"] };
  if (collection.status === "running") {
    return { status: "pending", analysisReady: false, reasons: ["Collecte en cours"] };
  }
  if (collection.status === "failed") {
    return { status: "unusable", analysisReady: false, reasons: ["Collecte échouée"] };
  }

  const scope = sources.filter((source) => source.active && (!requiredSourceIds || requiredSourceIds.includes(source.id)));
  const errors = scope.filter((source) => source.status === "error");
  const degraded = scope.filter((source) => source.status === "degraded");
  const reasons: string[] = [];
  if (collection.status === "partial") reasons.push("Collecte partielle");
  if (errors.length > 0) reasons.push(`Sources en erreur : ${errors.map((source) => source.source).join(", ")}`);
  if (degraded.length > 0) reasons.push(`Sources dégradées : ${degraded.map((source) => source.source).join(", ")}`);

  if (errors.length > 0) return { status: "unusable", analysisReady: false, reasons };
  if (reasons.length > 0) return { status: "degraded", analysisReady: false, reasons };
  return { status: "reliable", analysisReady: true, reasons: [] };
}
