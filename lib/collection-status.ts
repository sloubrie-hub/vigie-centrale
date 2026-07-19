import type { CollectionStatus } from "./watch-types.ts";

export function deriveCollectionStatus(succeeded: number, failed: number): CollectionStatus {
  if (succeeded === 0) return "failed";
  if (failed > 0) return "partial";
  return "completed";
}
