import DashboardClient from "@/app/dashboard-client";
import { readCollectionState, readLatestItems } from "@/lib/collection-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  let initialSnapshot;
  try {
    const [items, state] = await Promise.all([readLatestItems(), readCollectionState()]);
    initialSnapshot = {
      items,
      sources: state.sources,
      collection: state.collection,
      checkedAt: state.collection?.finishedAt || state.collection?.startedAt || null,
    };
  } catch {
    initialSnapshot = { items: [], sources: [], collection: null, checkedAt: null };
  }
  return <DashboardClient initialSnapshot={initialSnapshot} />;
}
