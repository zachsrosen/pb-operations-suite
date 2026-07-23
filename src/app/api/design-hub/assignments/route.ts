import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";
import {
  isDesignHubAllowedRole,
  isDesignHubEnabled,
} from "@/lib/design-hub/access";
import { TAB_CONFIGS } from "@/lib/design-hub/config";
import {
  fetchMyAssignments,
  toAssignmentView,
} from "@/lib/design-hub/assignments";
import { isDesignLead } from "@/lib/design-hub/roster";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import { batchReadDealsWithRetry } from "@/lib/hubspot";

const CreateSchema = z.object({
  tab: z.enum(["design", "da"]),
  dealId: z.string().min(1),
  assigneeEmail: z.string().email(),
  /** The status the assigner saw — used later for the "status moved" hint. */
  statusAtAssignment: z.string().min(1),
  note: z.string().max(2000).optional(),
  dueDate: z.string().datetime().optional(),
});

/** GET — the signed-in user's open assignments, hydrated with deal facts. */
export async function GET() {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await fetchMyAssignments(auth.email);
  if (rows.length === 0) {
    return NextResponse.json({ assignments: [], lastUpdated: new Date().toISOString() });
  }

  // Hydrate from HubSpot in ONE batch read rather than per-row. Both status
  // properties come along so a row's live status can be compared against
  // whichever tab it was assigned from.
  const dealIds = [...new Set(rows.map((r) => r.dealId))];
  const [response, designLabels, daLabels] = await Promise.all([
    batchReadDealsWithRetry(dealIds, [
      "dealname",
      "address_line_1",
      "city",
      "pb_location",
      "design_status",
      "layout_status",
    ]),
    getEnumLabelMap("design_status"),
    getEnumLabelMap("layout_status"),
  ]);

  const byId = new Map(
    ((response?.results ?? []) as Array<{
      id: string;
      properties?: Record<string, string | null>;
    }>).map((d) => [d.id, d.properties ?? {}]),
  );

  const assignments = rows.map((row) => {
    const props = byId.get(row.dealId);
    const config = TAB_CONFIGS[row.tab as "design" | "da"] ?? TAB_CONFIGS.design;
    const labels = config.statusProperty === "design_status" ? designLabels : daLabels;
    // undefined (not "") when the deal wasn't returned — toAssignmentView
    // treats undefined as "unknown", which suppresses a false moved hint.
    const currentStatus = props ? (props[config.statusProperty] ?? "") : undefined;
    return {
      ...toAssignmentView(row, currentStatus, labels),
      dealId: row.dealId,
      tab: row.tab,
      name: props?.dealname ?? "Untitled",
      address:
        [props?.address_line_1, props?.city].filter(Boolean).join(", ") || null,
      pbLocation: props?.pb_location ?? null,
      currentStatusLabel:
        currentStatus === undefined ? null : labelFor(labels, currentStatus),
    };
  });

  return NextResponse.json({
    assignments,
    lastUpdated: new Date().toISOString(),
  });
}

/** POST — push an ask at a designer. */
export async function POST(req: NextRequest) {
  if (!isDesignHubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;
  if (!isDesignHubAllowedRole(auth.roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Tolerate a malformed / missing body: parse defensively so bad JSON is a
  // 400 (validation failure) rather than a 500 (unhandled parse throw).
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { tab, dealId, assigneeEmail, statusAtAssignment, note, dueDate } =
    parsed.data;

  // Assignment targets are the static DESIGN_LEADS roster, not any valid
  // email — misassigning real work to a typo'd address is worse than a 400.
  if (!isDesignLead(assigneeEmail)) {
    return NextResponse.json(
      { error: `${assigneeEmail} is not a design lead` },
      { status: 400 },
    );
  }

  // One open ask per deal+assignee. Re-assigning the same deal to the same
  // person should update their note, not stack duplicate rows in their queue.
  const existing = await prisma.designAssignment.findFirst({
    where: { dealId, assigneeEmail, clearedAt: null },
  });
  if (existing) {
    return NextResponse.json(
      { error: "That deal is already assigned to them", assignmentId: existing.id },
      { status: 409 },
    );
  }

  const created = await prisma.designAssignment.create({
    data: {
      dealId,
      assigneeEmail,
      // From the session, never the body — the assigner cannot be spoofed.
      assignedBy: auth.email,
      note: note ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      tab,
      statusAtAssignment,
    },
  });

  return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
}
