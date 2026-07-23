/**
 * Project detail for the design hub. Ported from lib/pi-hub/detail.ts, trimmed
 * to what design coordinators use: deal facts, revision counters, both status
 * timelines, and recent activity. No AHJ/utility panels (that is P&I work) and
 * no shared-inbox correspondence (design does not run off a shared mailbox).
 */

import { hubspotClient } from "@/lib/hubspot";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import { buildOwnerMap } from "@/lib/idr-meeting";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { getHubSpotDealUrl } from "@/lib/external-links";
import { prisma } from "@/lib/db";
import { TAB_CONFIGS } from "./config";
import { resolveDesignLead } from "./leads";
import { toAssignmentView } from "./assignments";
import type {
  ProjectDetail,
  RevisionCounters,
  RevisionReason,
  Tab,
} from "./types";

/** Both status timelines are fetched together — the panel merges them. */
const HISTORY_PROPERTIES = "design_status,layout_status";

const PROPERTY_LABELS: Record<string, string> = {
  design_status: "Design",
  layout_status: "Design Approval",
};

const DETAIL_PROPERTIES = [
  "dealname",
  "address_line_1",
  "city",
  "state",
  "pb_location",
  "amount",
  "dealstage",
  "design_status",
  "layout_status",
  "design",
  "project_manager",
  "hubspot_owner_id",
  "calculated_system_size__kwdc_",
  "design_documents",
  "design_folder_url",
  "drive_folder_url",
  // Quick-link folders — same sources the IDR meeting hub uses.
  "site_survey_documents",
  "sales_documents",
  "all_document_parent_folder_id",
  // External design tools — surfaced as links in the detail pane.
  "os_project_link",
  "link_to_opensolar",
  "vishtik_project_url",
  "revision_counter",
  "total_revision_count",
  "da_revision_counter",
  "permit_revision_counter",
  "interconnection_revision_counter",
  "as_built_revision_counter",
  "idr_revision_counter",
  // Revision / change reasons — property→type mapping mirrors chat-tools.ts
  // stateContext (the canonical source). As-built has versioned history
  // fields; sales/ops changes are DA (layout_status) states.
  "design_approval_rejection_reason",
  "design_revision_reason",
  "permit_rejection_reason",
  "cause_of_permit_rejection_",
  "interconnection_rejection_reason",
  "cause_of_interconnection_rejection_",
  "idr_revision_reason",
  "idr_revision_type",
  "inspection_rejection_reason",
  "fourth_asbuilt_revision_reason",
  "third_as_built_revision_reason",
  "second_as_built_revision_reason",
  "first_as_built_rejection_reason",
  "sales_communication_reason",
  "ops_communication_reason",
];

/** A Drive folder field may hold a full URL or a bare folder id (IDR sources
 *  it the same way). Pass a URL through; build the folder URL from an id. */
function folderUrl(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  return v.startsWith("http")
    ? v
    : `https://drive.google.com/drive/folders/${v}`;
}

function num(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Populated revision / change reasons, labelled by workstream. The property→
 * type mapping mirrors chat-tools.ts stateContext (the canonical source):
 *   • design-revision reasons show whenever populated — they explain the
 *     revision and stay relevant while the revision is worked;
 *   • the DA "pending sales/ops changes" reasons show ONLY when the deal is
 *     actually in that layout_status, since those fields keep stale text after
 *     the deal moves on (`layoutStatus` gates them).
 */
function buildRevisionReasons(
  props: Record<string, string | null>,
  layoutStatus: string,
): RevisionReason[] {
  const val = (k: string): string | null => (props[k] ?? "").trim() || null;
  const joined = (...keys: string[]): string | null =>
    keys.map(val).filter(Boolean).join(" — ") || null;

  const out: RevisionReason[] = [];
  const push = (label: string, reason: string | null) => {
    if (reason) out.push({ label, reason });
  };

  push("DA", val("design_approval_rejection_reason"));
  push("Design", val("design_revision_reason"));
  push("Permit / AHJ", joined("permit_rejection_reason", "cause_of_permit_rejection_"));
  push(
    "Utility",
    joined("interconnection_rejection_reason", "cause_of_interconnection_rejection_"),
  );
  push("IDR", joined("idr_revision_reason", "idr_revision_type"));
  // As-built: current field first, then most recent numbered history entry.
  push(
    "As-Built",
    val("inspection_rejection_reason") ||
      val("fourth_asbuilt_revision_reason") ||
      val("third_as_built_revision_reason") ||
      val("second_as_built_revision_reason") ||
      val("first_as_built_rejection_reason"),
  );
  // DA change reasons — gated on the current layout_status (raw values).
  if (layoutStatus === "Pending Sales Changes") {
    push("Pending Sales Changes", val("sales_communication_reason"));
  }
  if (layoutStatus === "Pending Ops Changes") {
    push("Pending Ops Changes", val("ops_communication_reason"));
  }
  return out;
}

/**
 * Revision counters plus the mismatch that blocks design closeout — the
 * condition `sub-counter-attribution` exists to repair. Flagged here because
 * the hub is where a coordinator first meets the deal.
 */
function buildRevisionCounters(
  props: Record<string, string | null>,
): RevisionCounters {
  const counter = num(props.revision_counter);
  const total = num(props.total_revision_count);
  const da = num(props.da_revision_counter);
  const permit = num(props.permit_revision_counter);
  const interconnection = num(props.interconnection_revision_counter);
  const asBuilt = num(props.as_built_revision_counter);
  // IDR has its own counter and does NOT roll into revision_counter, so it's
  // excluded from subSum below — including it would fabricate mismatches.
  const idr = num(props.idr_revision_counter);

  // Two independent failure modes, either of which blocks closeout:
  //   • counter and total disagree
  //   • the four sub-counters don't sum to counter
  // Sub-counters that are entirely absent are treated as 0 rather than
  // "unknown" — an unset counter in HubSpot means no revisions of that type.
  const subSum = [da, permit, interconnection, asBuilt].reduce<number>(
    (acc, v) => acc + (v ?? 0),
    0,
  );
  const totalMismatch = counter !== null && total !== null && counter !== total;
  const subMismatch = counter !== null && subSum !== counter;

  return {
    total,
    counter,
    da,
    permit,
    interconnection,
    asBuilt,
    idr,
    mismatch: totalMismatch || subMismatch,
  };
}

export async function fetchProjectDetail(
  tab: Tab,
  dealId: string,
): Promise<ProjectDetail | null> {
  const config = TAB_CONFIGS[tab];

  const deal = await hubspotClient.crm.deals.basicApi.getById(
    dealId,
    DETAIL_PROPERTIES,
  );
  const props = (deal.properties ?? {}) as Record<string, string | null>;

  const [
    ownerMap,
    stageMap,
    statusLabels,
    otherStatusLabels,
    statusHistory,
    activity,
    assignmentRow,
    trueDesignOrder,
  ] = await Promise.all([
    buildOwnerMap([{ properties: props }]),
    buildStageDisplayMap(),
    getEnumLabelMap(config.statusProperty),
    getEnumLabelMap(config.otherStatusProperty),
    fetchStatusHistory(dealId),
    fetchActivity(dealId),
    prisma.designAssignment.findFirst({
      where: { dealId, tab, clearedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    // Most recent TrueDesign export for this deal, if any. Ordered by pull
    // time so a re-order surfaces the latest design PDF. Nulls sort last, so
    // filter to rows that actually have a design PDF file.
    prisma.eagleViewOrder.findFirst({
      where: { dealId, designPdfDriveFileId: { not: null } },
      orderBy: { designFilesPulledAt: "desc" },
      select: { designPdfDriveFileId: true },
    }),
  ]);

  const status = props[config.statusProperty] ?? "";
  const otherStatus = props[config.otherStatusProperty] ?? "";
  const pmId = props.project_manager;

  return {
    deal: {
      id: dealId,
      name: props.dealname ?? "Untitled",
      address:
        [props.address_line_1, props.city].filter(Boolean).join(", ") || null,
      amount: num(props.amount),
      pbLocation: props.pb_location ?? null,
      lead: resolveDesignLead(config, props, ownerMap),
      pm: pmId ? (ownerMap.get(pmId) ?? pmId) : null,
      status,
      statusLabel: labelFor(statusLabels, status),
      otherStatusLabel: otherStatus
        ? labelFor(otherStatusLabels, otherStatus)
        : null,
      systemSizeKw: num(props.calculated_system_size__kwdc_),
      dealStage: props.dealstage ? (stageMap[props.dealstage] ?? null) : null,
      hubspotUrl: getHubSpotDealUrl(dealId),
      // These properties hold URLs, not bare folder IDs.
      designFolderUrl: props.design_folder_url || props.design_documents || null,
      surveyFolderUrl: props.site_survey_documents ?? null,
      salesFolderUrl: props.sales_documents ?? null,
      // Drive: prefer the all-documents parent folder (what the IDR hub links
      // to). It may be a full URL or a bare folder id — build the URL from an
      // id, pass a URL through, and fall back to drive_folder_url.
      driveFolderUrl: folderUrl(props.all_document_parent_folder_id) ?? props.drive_folder_url ?? null,
      openSolarUrl: props.os_project_link || props.link_to_opensolar || null,
      vishtikUrl: props.vishtik_project_url || null,
      // designPdfDriveFileId is a Drive FILE id, not a URL — build the viewer
      // link the same way the PE tooling does.
      trueDesignUrl: trueDesignOrder?.designPdfDriveFileId
        ? `https://drive.google.com/file/d/${trueDesignOrder.designPdfDriveFileId}/view`
        : null,
    },
    revisions: buildRevisionCounters(props),
    // layout_status drives the sales/ops-change gating regardless of which tab
    // is active — it's always fetched.
    revisionReasons: buildRevisionReasons(props, props.layout_status ?? ""),
    assignment: assignmentRow
      ? toAssignmentView(assignmentRow, status, statusLabels)
      : null,
    statusHistory,
    activity,
  };
}

async function fetchStatusHistory(
  dealId: string,
): Promise<ProjectDetail["statusHistory"]> {
  // HubSpot property-history endpoint — the shape is
  // { propertiesWithHistory: { <prop>: [{ value, timestamp }, ...] } }.
  // Not available through the typed SDK, hence the raw fetch.
  try {
    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) return [];
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`);
    url.searchParams.set("propertiesWithHistory", HISTORY_PROPERTIES);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as {
      propertiesWithHistory?: Record<
        string,
        Array<{ value: string; timestamp: string }>
      >;
    };
    const labelMaps = new Map(
      await Promise.all(
        Object.keys(body.propertiesWithHistory ?? {}).map(
          async (p) => [p, await getEnumLabelMap(p)] as const,
        ),
      ),
    );
    const history: ProjectDetail["statusHistory"] = [];
    for (const [property, entries] of Object.entries(
      body.propertiesWithHistory ?? {},
    )) {
      const labels = labelMaps.get(property);
      for (const entry of entries) {
        history.push({
          property,
          propertyLabel: PROPERTY_LABELS[property] ?? property,
          value: entry.value ?? null,
          valueLabel:
            labels && entry.value ? labelFor(labels, entry.value) : null,
          timestamp: entry.timestamp,
        });
      }
    }
    history.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
    return history;
  } catch {
    // History is context, never the point of the panel — a failure renders an
    // empty timeline rather than failing the whole detail request.
    return [];
  }
}

async function fetchActivity(
  dealId: string,
): Promise<ProjectDetail["activity"]> {
  try {
    const { getDealEngagements } = await import("@/lib/hubspot-engagements");
    const engagements = await getDealEngagements(dealId);
    // No keyword filter, unlike pi-hub: design work has no distinguishing
    // vocabulary the way permit/utility correspondence does, and filtering on
    // guessed keywords would hide the notes that matter.
    return engagements.slice(0, 50).map((e) => ({
      id: e.id,
      type: e.type,
      subject: e.subject,
      body: e.body,
      timestamp: e.timestamp,
    }));
  } catch {
    return [];
  }
}
