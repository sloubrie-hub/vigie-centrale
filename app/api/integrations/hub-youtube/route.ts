import { cacheHubYoutubeExport, readHubYoutubeEnvelope, readYoutubeCoverage } from "@/lib/youtube-collection";

export const dynamic = "force-dynamic";

const noCache = { "Cache-Control": "no-store, max-age=0" };

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production" || process.env.VIGIE_HUB_OBSERVE !== "true") {
    return new Response(null, { status: 404 });
  }
  const day = new URL(request.url).searchParams.get("day");
  const date = day ? new Date(`${day}T12:00:00.000Z`) : new Date();
  const age = Date.now() - date.getTime();
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !(age >= -12 * 3600_000 && age <= 8 * 86400_000) ||
      date.toISOString().slice(0, 10) !== day)) return new Response(null, { status: 400 });
  return Response.json({ coverage: await readYoutubeCoverage(date) }, { headers: noCache });
}

export async function POST(request: Request) {
  const enabled = process.env.VIGIE_HUB_OBSERVE === "true" || process.env.VIGIE_HUB_REUSE === "true";
  if (process.env.VERCEL_ENV !== "production" || !enabled || !process.env.VIGIE_HUB_EXPORT_PUBLIC_KEY) {
    return new Response(null, { status: 404 });
  }
  try {
    const lot = await cacheHubYoutubeExport(await readHubYoutubeEnvelope(request), true);
    if (!lot) return Response.json({ error: "Lot nocturne ou signature invalide." }, { status: 422, headers: noCache });
    return Response.json({ state: "accepted", run_id: lot.run_id }, { status: 202, headers: noCache });
  } catch {
    return Response.json({ error: "Cache de Vigie indisponible." }, { status: 503, headers: noCache });
  }
}
