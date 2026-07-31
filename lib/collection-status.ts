import type { CollectionStatus } from "./watch-types.ts";

export function deriveCollectionStatus(succeeded: number, failed: number): CollectionStatus {
  if (succeeded === 0) return "failed";
  if (failed > 0) return "partial";
  return "completed";
}

export function summarizeSourceResults(results: { ok: boolean; journaled: boolean }[]) {
  const succeeded = results.filter((result) => result.ok && result.journaled).length;
  return { succeeded, failed: results.length - succeeded };
}

export function summarizeCollectionMetrics(
  results: { itemsCollected: number; itemsPublished: number }[],
  itemsStored: number,
) {
  return {
    itemsCollected: results.reduce((total, result) => total + result.itemsCollected, 0),
    itemsPublished: results.reduce((total, result) => total + result.itemsPublished, 0),
    itemsStored,
  };
}
