import assert from "node:assert/strict";
import test from "node:test";
import { requestJson, requestText, safeDiagnostic } from "../lib/http-client.ts";

const response = (body, status, headers = {}) => new Response(body, { status, headers });

test("un timeout HTTP produit un diagnostic borné", async () => {
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
  await assert.rejects(
    requestText("https://example.test", { label: "Source test", timeoutMs: 5, maxRetries: 0, fetchImpl }),
    /Timeout après 5 ms — Source test/,
  );
});

test("un timeout est retenté au maximum une fois", async () => {
  let attempts = 0;
  const fetchImpl = (_url, init) => {
    attempts += 1;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  };
  await assert.rejects(requestText("https://example.test", {
    label: "Source test", timeoutMs: 2, fetchImpl, sleep: async () => {},
  }));
  assert.equal(attempts, 2);
});

test("HTTP 500 est identifié comme indisponibilité transitoire", async () => {
  await assert.rejects(
    requestText("https://example.test", { label: "Source test", maxRetries: 0, fetchImpl: async () => response("", 500) }),
    /HTTP 500 — service indisponible/,
  );
});

test("HTTP 429 est identifié comme limite de requêtes", async () => {
  await assert.rejects(
    requestText("https://example.test", { label: "Source test", maxRetries: 0, fetchImpl: async () => response("", 429) }),
    /HTTP 429 — limite de requêtes/,
  );
});

test("un Retry-After raisonnable est respecté avant l'unique retry", async () => {
  let attempts = 0;
  const waits = [];
  const result = await requestText("https://example.test", {
    label: "Source test",
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? response("", 429, { "retry-after": "0.5" }) : response("ok", 200);
    },
    sleep: async (duration) => { waits.push(duration); },
  });
  assert.equal(result.text, "ok");
  assert.deepEqual(waits, [500]);
});

test("HTTP 401 n'est jamais retenté", async () => {
  let attempts = 0;
  await assert.rejects(
    requestText("https://example.test", {
      label: "OAuth France Travail",
      fetchImpl: async () => { attempts += 1; return response("", 401); },
      sleep: async () => {},
    }),
    /OAuth France Travail : HTTP 401 — authentification refusée/,
  );
  assert.equal(attempts, 1);
});

test("une réponse JSON invalide échoue sans devenir un succès vide", async () => {
  await assert.rejects(
    requestJson("https://example.test", {
      label: "API France Travail",
      fetchImpl: async () => response("{invalide", 200, { "content-type": "application/json" }),
    }),
    /réponse JSON invalide/,
  );
});

test("une erreur transitoire est retentée une seule fois", async () => {
  let attempts = 0;
  const result = await requestText("https://example.test", {
    label: "Source test",
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1 ? response("", 503) : response("ok", 200);
    },
    sleep: async () => {},
  });
  assert.equal(result.text, "ok");
  assert.equal(attempts, 2);
});

test("le nombre de tentatives reste borné", async () => {
  let attempts = 0;
  await assert.rejects(requestText("https://example.test", {
    label: "Source test",
    maxRetries: 99,
    fetchImpl: async () => { attempts += 1; return response("", 503); },
    sleep: async () => {},
  }));
  assert.equal(attempts, 2);
});

test("les secrets sont masqués dans les diagnostics persistables", () => {
  const diagnostic = safeDiagnostic(new Error("Bearer abc123 client_secret=secret-value token=my-token password=pwd"));
  assert.doesNotMatch(diagnostic, /abc123|secret-value|my-token|pwd/);
  assert.match(diagnostic, /\[MASQUÉ\]/);
});
