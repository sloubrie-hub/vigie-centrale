import { readArchive } from "@/lib/archive";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const items = await readArchive(searchParams.get("q") || "", searchParams.get("theme") || "");
  return Response.json({ items, count: items.length, storage: process.env.DATABASE_URL ? "live" : "unconfigured" }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
