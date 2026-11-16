import { inspectHubYoutubeCoverage, verifyHubYoutubeExport } from "@/lib/youtube-collection";

export const dynamic = "force-dynamic";

const noCache = { "Cache-Control": "no-store, max-age=0" };
const exportForm = `<!doctype html>
<html lang="fr"><meta charset="utf-8"><title>Vigie · essai du lot Hub</title>
<main><h1>Vérifier un lot signé du Hub</h1>
<form method="post"><label for="export">Lot signé du Hub</label><br>
<textarea id="export" name="export" rows="8" cols="64" required></textarea><br>
<button type="submit">Comparer aux flux YouTube</button></form></main></html>`;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  if (new URL(request.url).searchParams.get("form") === "1") {
    return new Response(exportForm, { headers: { ...noCache, "Content-Type": "text/html; charset=utf-8" } });
  }
  return Response.json(await inspectHubYoutubeCoverage(), { headers: noCache });
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  if (Number(request.headers.get("content-length")) > 512 * 1024) return new Response(null, { status: 413 });
  let envelope: unknown;
  try {
    const text = await request.text();
    if (text.length > 512 * 1024) return new Response(null, { status: 413 });
    const body = request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")
      ? new URLSearchParams(text).get("export") : text;
    envelope = body ? JSON.parse(body) : null;
  } catch {
    return Response.json({ error: "Lot illisible." }, { status: 400, headers: noCache });
  }
  const lot = verifyHubYoutubeExport(envelope);
  if (!lot) return Response.json({ error: "Signature ou lot invalide." }, { status: 422, headers: noCache });
  return Response.json(await inspectHubYoutubeCoverage(lot), { headers: noCache });
}
