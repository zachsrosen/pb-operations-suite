import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth-utils";
import DashboardShell from "@/components/DashboardShell";
import { prisma } from "@/lib/db";
import { batchReadDealsWithRetry } from "@/lib/hubspot";
import { fetchOwnerMap } from "@/lib/deal-sync";
import { getHubSpotDealUrl } from "@/lib/external-links";
import EagleViewOrdersClient, { type OrderListRow } from "./EagleViewOrdersClient";

export const dynamic = "force-dynamic";

const DEAL_NAME_PROPS = [
  "dealname",
  "address_line_1",
  "address",
  "city",
  "state",
  "postal_code",
  "zip",
  "pb_location",
  "design", // "Design Lead" — enumeration of HubSpot user IDs; resolved to a name below
];

export default async function EagleViewOrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  // All EagleView orders, newest first.
  const orders = await prisma.eagleViewOrder.findMany({
    orderBy: { orderedAt: "desc" },
  });

  // Resolve friendly deal names + addresses from HubSpot (the project cache is
  // empty for these deals). Best-effort: on failure rows fall back to the deal id.
  const dealIds = Array.from(
    new Set(orders.map((o) => o.dealId).filter((d) => d && !d.startsWith("ticket:"))),
  );
  // The `design` ("Design Lead") property stores a HubSpot owner/user ID. It's a
  // user-reference enumeration, so the property options aren't inlined — resolve
  // the id to a name via the owner map (same source deal-sync uses for this
  // field). Best-effort: on failure the column just stays blank.
  let ownerMap: Record<string, string> = {};
  try {
    ownerMap = await fetchOwnerMap();
  } catch (err) {
    console.error("[eagleview-orders] owner map fetch failed", err);
  }

  const byDeal = new Map<
    string,
    {
      dealName: string | null;
      address: string | null;
      pbLocation: string | null;
      designLead: string | null;
    }
  >();
  try {
    for (let i = 0; i < dealIds.length; i += 100) {
      const chunk = dealIds.slice(i, i + 100);
      const resp = await batchReadDealsWithRetry(chunk, DEAL_NAME_PROPS);
      for (const d of resp?.results ?? []) {
        const p = (d.properties ?? {}) as Record<string, string | null | undefined>;
        const addr =
          [p.address_line_1 ?? p.address, p.city, p.state, p.postal_code ?? p.zip]
            .filter(Boolean)
            .join(", ") || null;
        const designId = p.design ? String(p.design) : null;
        byDeal.set(d.id, {
          dealName: p.dealname ?? null,
          address: addr,
          pbLocation: p.pb_location ?? null,
          designLead: designId ? ownerMap[designId] ?? null : null,
        });
      }
    }
  } catch (err) {
    console.error("[eagleview-orders] deal name batch read failed", err);
  }

  const rows: OrderListRow[] = orders.map((o) => {
    const d = byDeal.get(o.dealId);
    return {
      id: o.id,
      dealId: o.dealId,
      ticketId: o.ticketId,
      reportId: o.reportId,
      status: o.status,
      triggeredBy: o.triggeredBy,
      orderedAt: o.orderedAt.toISOString(),
      deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
      driveFolderId: o.driveFolderId,
      errorMessage: o.errorMessage,
      failedAttempts: o.failedAttempts,
      dealName: d?.dealName ?? null,
      address: d?.address ?? null,
      pbLocation: d?.pbLocation ?? null,
      designLead: d?.designLead ?? null,
      hubspotUrl: o.dealId && !o.dealId.startsWith("ticket:") ? getHubSpotDealUrl(o.dealId) : null,
    };
  });

  return (
    <DashboardShell title="EagleView Orders" accentColor="orange">
      <EagleViewOrdersClient userEmail={user.email} initialOrders={rows} />
    </DashboardShell>
  );
}
