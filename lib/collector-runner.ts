import { CollectorDiagnosticError, safeDiagnostic } from "./http-client.ts";
import type { SourceDefinition, SourceRunStatus, WatchItem } from "./watch-types.ts";

export const SOURCE_TIMEOUT_MS = 20_000;

export type CollectorOutput = {
  items: WatchItem[];
  itemsCollected: number;
};
export type CollectorTask = {
  source: SourceDefinition;
  run: () => Promise<CollectorOutput>;
  timeoutMs?: number;
};
export type CollectorTaskResult = {
  ok: boolean;
  journaled: boolean;
  items: WatchItem[];
  itemsCollected: number;
  itemsPublished: number;
  sourceId: string;
  errorMessage?: string;
};
type SourceRunRecorder = (input: {
  collectionRunId: string;
  sourceId: string;
  startedAt: string;
  finishedAt: string;
  status: SourceRunStatus;
  itemsCollected: number;
  itemsPublished: number;
  durationMs: number;
  errorMessage?: string;
}) => Promise<void>;

export function publishAll(items: WatchItem[]): CollectorOutput {
  return { items, itemsCollected: items.length };
}

export async function withSourceTimeout<T>(operation: Promise<T>, timeoutMs = SOURCE_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new CollectorDiagnosticError(`Timeout collecteur après ${timeoutMs} ms`, "timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeTask(task: CollectorTask, collectionRunId: string, record: SourceRunRecorder): Promise<CollectorTaskResult> {
  const startedAt = new Date();
  let ok = false;
  let output: CollectorOutput = { items: [], itemsCollected: 0 };
  let errorMessage: string | undefined;
  try {
    output = await withSourceTimeout(Promise.resolve().then(task.run), task.timeoutMs ?? SOURCE_TIMEOUT_MS);
    if (!Number.isInteger(output.itemsCollected) || output.itemsCollected < output.items.length) {
      throw new CollectorDiagnosticError("Métriques collecteur invalides", "invalid_response");
    }
    ok = true;
  } catch (error) {
    errorMessage = safeDiagnostic(error);
    output = { items: [], itemsCollected: 0 };
  }
  const finishedAt = new Date();
  const itemsPublished = output.items.length;
  try {
    await record({
      collectionRunId,
      sourceId: task.source.id,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      status: ok ? "completed" : "failed",
      itemsCollected: output.itemsCollected,
      itemsPublished,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      errorMessage,
    });
    return {
      ok,
      journaled: true,
      items: output.items,
      itemsCollected: output.itemsCollected,
      itemsPublished,
      sourceId: task.source.id,
      errorMessage,
    };
  } catch (journalError) {
    console.error(`Journalisation impossible pour la source ${task.source.id}`, journalError);
    return {
      ok,
      journaled: false,
      items: output.items,
      itemsCollected: output.itemsCollected,
      itemsPublished,
      sourceId: task.source.id,
      errorMessage,
    };
  }
}

export async function executeCollectorTasks(tasks: CollectorTask[], collectionRunId: string, record: SourceRunRecorder) {
  const settled = await Promise.allSettled(tasks.map((task) => executeTask(task, collectionRunId, record)));
  return settled.map((result, index): CollectorTaskResult => result.status === "fulfilled" ? result.value : ({
    ok: false,
    journaled: false,
    items: [],
    itemsCollected: 0,
    itemsPublished: 0,
    sourceId: tasks[index].source.id,
    errorMessage: safeDiagnostic(result.reason),
  }));
}
