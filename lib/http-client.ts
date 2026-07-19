export const DEFAULT_HTTP_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const MAX_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 1_000;

type FetchImplementation = typeof fetch;

export class CollectorDiagnosticError extends Error {
  readonly category: "timeout" | "network" | "http" | "invalid_response" | "parsing";
  readonly transient: boolean;
  readonly retryAfterMs: number | null;

  constructor(
    message: string,
    category: "timeout" | "network" | "http" | "invalid_response" | "parsing",
    transient = false,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "CollectorDiagnosticError";
    this.category = category;
    this.transient = transient;
    this.retryAfterMs = retryAfterMs;
  }
}

export type HttpRequestOptions = RequestInit & {
  label: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
  acceptedContentTypes?: string[];
  fetchImpl?: FetchImplementation;
  sleep?: (durationMs: number) => Promise<void>;
};

type TextResponse = { status: number; text: string };

const wait = (durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs));

function retryAfterMs(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

function httpError(label: string, response: Response) {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new CollectorDiagnosticError(`${label} : HTTP ${status} — authentification refusée`, "http");
  }
  if (status === 429) {
    return new CollectorDiagnosticError(
      `${label} : HTTP 429 — limite de requêtes`,
      "http",
      true,
      retryAfterMs(response.headers.get("retry-after")),
    );
  }
  if (status >= 500) {
    return new CollectorDiagnosticError(`${label} : HTTP ${status} — service indisponible`, "http", true);
  }
  return new CollectorDiagnosticError(`${label} : HTTP ${status} — requête refusée`, "http");
}

async function readBoundedBody(response: Response, maxBytes: number, label: string) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new CollectorDiagnosticError(`${label} : réponse trop volumineuse`, "invalid_response");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new CollectorDiagnosticError(`${label} : réponse trop volumineuse`, "invalid_response");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function canRetry(error: unknown, attempt: number, maxRetries: number) {
  return error instanceof CollectorDiagnosticError && error.transient && attempt <= maxRetries;
}

export async function requestText(url: string, options: HttpRequestOptions): Promise<TextResponse> {
  const {
    label,
    timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    maxRetries = MAX_RETRIES,
    acceptedContentTypes,
    fetchImpl = fetch,
    sleep = wait,
    ...init
  } = options;
  const boundedRetries = Math.max(0, Math.min(maxRetries, MAX_RETRIES));

  for (let attempt = 1; attempt <= boundedRetries + 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) throw httpError(label, response);
      const contentType = response.headers.get("content-type")?.toLowerCase();
      if (contentType && acceptedContentTypes && !acceptedContentTypes.some((type) => contentType.includes(type))) {
        throw new CollectorDiagnosticError(`${label} : type de réponse inattendu`, "invalid_response");
      }
      return { status: response.status, text: await readBoundedBody(response, maxResponseBytes, label) };
    } catch (error) {
      let diagnostic: CollectorDiagnosticError;
      if (error instanceof CollectorDiagnosticError) diagnostic = error;
      else if (error instanceof Error && error.name === "AbortError") {
        diagnostic = new CollectorDiagnosticError(`Timeout après ${timeoutMs} ms — ${label}`, "timeout", true);
      } else {
        diagnostic = new CollectorDiagnosticError(`${label} : erreur réseau`, "network", true);
      }
      if (!canRetry(diagnostic, attempt, boundedRetries)) throw diagnostic;
      const delay = diagnostic.retryAfterMs ?? 200;
      if (delay > MAX_RETRY_DELAY_MS) throw diagnostic;
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new CollectorDiagnosticError(`${label} : erreur réseau`, "network");
}

export async function requestJson<T>(
  url: string,
  options: HttpRequestOptions & { allowEmpty?: boolean },
): Promise<T | null> {
  const { allowEmpty = false, ...requestOptions } = options;
  const response = await requestText(url, {
    ...requestOptions,
    acceptedContentTypes: requestOptions.acceptedContentTypes || ["application/json", "+json"],
  });
  if (response.status === 204 || response.text.trim() === "") {
    if (allowEmpty) return null;
    throw new CollectorDiagnosticError(`${options.label} : réponse JSON vide`, "invalid_response");
  }
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new CollectorDiagnosticError(`${options.label} : réponse JSON invalide`, "parsing");
  }
}

export function safeDiagnostic(error: unknown) {
  const raw = error instanceof Error ? error.message : "Erreur de collecte inconnue";
  return raw
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [MASQUÉ]")
    .replace(/((?:client[_-]?secret|access[_-]?token|password|secret|token)\s*[=:]\s*)[^\s&;,]+/gi, "$1[MASQUÉ]")
    .slice(0, 500);
}
