export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }
  const response = await fetch(new URL("/api/veille?scheduled=1", request.url), { cache: "no-store" });
  if (!response.ok) return Response.json({ error: "Collecte en échec" }, { status: 502 });
  const data = await response.json();
  return Response.json({ ok: true, collected: data.items?.length || 0, archive: data.archive, checkedAt: data.checkedAt });
}
