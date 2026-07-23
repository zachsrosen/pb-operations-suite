import { NextRequest, NextResponse } from "next/server";
import { searchWithRetry } from "@/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { INCLUDED_PIPELINES } from "@/lib/daily-focus/config";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";

/**
 * Free-text deal search for the global "Assign a project" flow — lets a
 * coordinator assign ANY deal, including ones absent from the queue (no design
 * status yet). Scoped to the same pipelines the queue uses so results are
 * real project deals, not stray records.
 */
export async function GET(req: NextRequest) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ deals: [] });
  }

  const properties = [
    "dealname",
    "address_line_1",
    "city",
    "pb_location",
    "design_status",
    "layout_status",
    "dealstage",
  ];

  try {
    // HubSpot `query` is full-text over searchable properties (dealname,
    // project number, address). AND-combined with the pipeline filter so only
    // real project deals come back. Sorted by HubSpot relevance (default).
    const response = await searchWithRetry({
      query: q,
      filterGroups: [
        {
          filters: [
            {
              propertyName: "pipeline",
              operator: FilterOperatorEnum.In,
              values: INCLUDED_PIPELINES,
            },
          ],
        },
      ],
      properties,
      limit: 15,
    } as unknown as Parameters<typeof searchWithRetry>[0]);

    const results = (response.results ?? []) as Array<{
      id: string;
      properties?: Record<string, string | null>;
    }>;

    const [designLabels, daLabels] = await Promise.all([
      getEnumLabelMap("design_status"),
      getEnumLabelMap("layout_status"),
    ]);

    const deals = results.map((d) => {
      const p = d.properties ?? {};
      const designStatus = p.design_status ?? "";
      const layoutStatus = p.layout_status ?? "";
      return {
        dealId: d.id,
        name: p.dealname ?? "Untitled",
        address:
          [p.address_line_1, p.city].filter(Boolean).join(", ") || null,
        pbLocation: p.pb_location ?? null,
        // Both status VALUES ride along so the assign call can record the
        // right baseline for whichever tab it targets.
        designStatus,
        layoutStatus,
        designStatusLabel: designStatus
          ? labelFor(designLabels, designStatus)
          : "No design status",
        layoutStatusLabel: layoutStatus
          ? labelFor(daLabels, layoutStatus)
          : "No DA status",
      };
    });

    return NextResponse.json({ deals });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
