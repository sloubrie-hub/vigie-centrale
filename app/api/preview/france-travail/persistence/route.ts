import { neon } from "@neondatabase/serverless";
import { persistFranceTravailOffers, type FranceTravailOffer } from "@/lib/france-travail-job-offer";
import { upsertJobOfferFromSource } from "@/lib/job-offer-store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const count = 2_906;
const branch = "codex/recette-pagination-ft-20261116";
const marker = "vigie-p12-20261116-schema-seul";
const first = "2026-11-16T09:00:00Z";
const second = "2026-11-16T10:00:00Z";
const responseHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "same-origin" };
const fixtureId = (index: number) => `vigie-p12-fixture-${index + 1}`;

function isRecipePreview() {
  return process.env.VERCEL_ENV === "preview" && process.env.VERCEL_GIT_COMMIT_REF === branch;
}

export function GET() {
  if (!isRecipePreview()) return new Response(null, { status: 404 });
  return new Response(`<!doctype html><html lang="fr"><meta charset="utf-8">
    <title>Recette France Travail · Vigie</title><h1>Persistance de 2 906 offres fictives</h1>
    <form method="post"><button name="action" value="insert">Premier passage</button>
    <button name="action" value="replay">Rejouer le passage</button></form></html>`, {
    headers: { ...responseHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  if (!isRecipePreview()) return new Response(null, { status: 404 });
  const origin = request.headers.get("origin");
  const sameSite = origin === new URL(request.url).origin || origin === `https://${process.env.VERCEL_URL}`;
  if (request.headers.get("sec-fetch-site") !== "same-origin" || !sameSite) {
    return Response.json({ status: "origin_denied" }, { status: 403, headers: responseHeaders });
  }
  const connection = process.env.P12_RECIPE_DATABASE_URL;
  const action = (await request.formData()).get("action");
  if (!connection || (action !== "insert" && action !== "replay")) {
    return Response.json({ status: "unavailable" }, { status: 400, headers: responseHeaders });
  }
  const sql = neon(connection);
  try {
    const proof = await sql`SELECT marker FROM codex_vigie_p12_recipe_marker`;
    if (proof.length !== 1 || proof[0].marker !== marker) {
      return Response.json({ status: "isolation_check_failed" }, { status: 409, headers: responseHeaders });
    }
    const previous = await sql`SELECT count(*)::integer AS n FROM job_offer_sources
      WHERE source_id = 'france-travail' AND external_id LIKE 'vigie-p12-fixture-%'`;
    const expectedPrevious = action === "insert" ? 0 : count;
    if (previous[0]?.n !== expectedPrevious) {
      return Response.json({ status: "unexpected_fixture_count", previous: previous[0]?.n },
        { status: 409, headers: responseHeaders });
    }
    const offers: FranceTravailOffer[] = Array.from({ length: count }, (_, index) => ({
      id: fixtureId(index),
      intitule: "Conseiller en insertion en structure fictive",
      description: "Description synthétique de la mission locale. ".repeat(30),
      dateCreation: "2026-11-16T08:00:00Z",
      typeContrat: "CDI",
      typeContratLibelle: "Contrat à durée indéterminée",
      entreprise: { nom: "Employeur fictif" },
      lieuTravail: { libelle: "Marmande", codePostal: "47200", commune: "47157" },
      romeCode: "K1801",
    }));
    const last = action === "insert" ? first : second;
    const start = performance.now();
    await persistFranceTravailOffers(offers, last, input => upsertJobOfferFromSource(input, sql));
    const elapsedMs = Math.round(performance.now() - start);
    const [metrics] = await sql`SELECT COUNT(*)::integer AS provenances,
        COUNT(DISTINCT o.id)::integer AS offers,
        COUNT(DISTINCT s.external_id)::integer AS identifiers,
        COUNT(*) FILTER (WHERE o.first_seen_at = ${first}::timestamptz
          AND o.last_seen_at = ${last}::timestamptz
          AND s.first_seen_at = ${first}::timestamptz
          AND s.last_seen_at = ${last}::timestamptz)::integer AS dates_verified
      FROM job_offer_sources s JOIN job_offers o ON o.id = s.job_offer_id
      WHERE s.source_id = 'france-travail' AND s.external_id LIKE 'vigie-p12-fixture-%'`;
    const complete = metrics?.provenances === count && metrics?.offers === count
      && metrics?.identifiers === count && metrics?.dates_verified === count;
    return Response.json({ status: complete ? "complete" : "incomplete", action, elapsedMs, ...metrics },
      { status: complete ? 200 : 500, headers: responseHeaders });
  } catch {
    return Response.json({ status: "database_error", action }, { status: 502, headers: responseHeaders });
  }
}
