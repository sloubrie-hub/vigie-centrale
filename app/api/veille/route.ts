import { readCollectionState, readLatestItems } from "@/lib/collection-store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [items, state] = await Promise.all([readLatestItems(), readCollectionState()]);
    return Response.json({
      items,
      sources: state.sources,
      collection: state.collection,
      reliability: state.reliability,
      checkedAt: state.collection?.finishedAt || state.collection?.startedAt || null,
      storage: process.env.DATABASE_URL ? "live" : "unconfigured",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch {
    return Response.json({
      items: [], sources: [], collection: null, reliability: null, checkedAt: null,
      storage: process.env.DATABASE_URL ? "error" : "unconfigured",
      error: "Lecture des dernières données indisponible",
    }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
