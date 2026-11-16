import { inspectHubYoutubeCoverage } from "@/lib/youtube-collection";

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") return new Response(null, { status: 404 });
  return Response.json(await inspectHubYoutubeCoverage(), {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
