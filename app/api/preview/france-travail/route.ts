import { readFranceTravailOffers, type FranceTravailPage } from "@/lib/collector";
import { safeDiagnostic } from "@/lib/http-client";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "preview" || new URL(request.url).searchParams.get("probe") !== "1") {
    return new Response(null, { status: 404 });
  }
  const headers = { "Cache-Control": "no-store" };
  const pages: FranceTravailPage[] = [];
  try {
    const offers = await readFranceTravailOffers((page) => pages.push(page));
    return Response.json({ state: "complete", uniqueCount: offers.length, pages }, { headers });
  } catch (error) {
    return Response.json({ state: "blocked", error: safeDiagnostic(error), pages }, { status: 502, headers });
  }
}
