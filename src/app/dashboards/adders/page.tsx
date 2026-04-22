import DashboardShell from "@/components/DashboardShell";
import { listAdders } from "@/lib/adders/catalog";
import AddersClient from "./AddersClient";

export const dynamic = "force-dynamic";

export default async function AddersPage() {
  // Fetch all adders (active and inactive) for the initial page load; client
  // applies active/category/shop filters on top of this set.
  const initialAdders = await listAdders({});
  // Serialize Prisma Decimal columns to number strings for client transfer.
  const serialized = initialAdders.map((a) => ({
    ...a,
    basePrice: String(a.basePrice),
    baseCost: String(a.baseCost),
    marginTarget: a.marginTarget == null ? null : String(a.marginTarget),
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    overrides: a.overrides.map((o) => ({
      ...o,
      priceDelta: String(o.priceDelta),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    })),
  }));

  return (
    <DashboardShell title="Adder Catalog" accentColor="green">
      <AddersClient initialAdders={serialized} />
    </DashboardShell>
  );
}
