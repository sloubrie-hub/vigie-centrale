import { cacheHubYoutubeExport, inspectHubYoutubeCoverage, readHubYoutubeEnvelope } from "@/lib/youtube-collection";

export const dynamic = "force-dynamic";

const noCache = { "Cache-Control": "no-store, max-age=0" };
const exportForm = `<!doctype html>
<html lang="fr"><meta charset="utf-8"><title>Vigie · essai du lot Hub</title>
<main><h1>Vérifier un lot signé du Hub</h1>
<form method="post"><label for="export">Lot signé du Hub</label><br>
<textarea id="export" name="export" rows="8" cols="64" required></textarea><br>
<button type="submit">Déposer le lot</button></form></main></html>`;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  if (new URL(request.url).searchParams.get("form") === "1") {
    return new Response(exportForm, { headers: { ...noCache, "Content-Type": "text/html; charset=utf-8" } });
  }
  return Response.json(await inspectHubYoutubeCoverage(), { headers: noCache });
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  try {
    const lot = await cacheHubYoutubeExport(await readHubYoutubeEnvelope(request));
    if (!lot) return Response.json({ error: "Signature ou lot invalide." }, { status: 422, headers: noCache });
    return Response.json({ state: "lot vérifié et déposé", id: lot.run_id, finishedAt: lot.finished_at }, { status: 202, headers: noCache });
  } catch {
    return Response.json({ error: "Cache de Preview indisponible." }, { status: 503, headers: noCache });
  }
}
