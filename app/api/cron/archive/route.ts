import { runCollection } from "@/lib/collector";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const result = await runCollection();
    return Response.json({ ok: result.status !== "failed", ...result }, {
      status: result.status === "failed" ? 502 : 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Collecte en échec" }, {
      status: 502, headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
