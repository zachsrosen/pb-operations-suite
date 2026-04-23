/**
 * GET /api/admin/workflows/hubspot-property-options
 *   ?objectType=deal|contact|ticket
 *   &propertyName=<hubspot property name>
 *
 * Unified lookup for "values for this property" used by the editor's
 * propertyValuesIn multiselect. The response shape matches the existing
 * hubspot-pipelines endpoint:
 *   { options: [{ value, label, group? }] }
 *
 * Coverage:
 * - deal + dealstage            → pipeline stages (all deal pipelines)
 * - ticket + hs_pipeline_stage  → pipeline stages (all ticket pipelines)
 * - ticket + hs_ticket_priority → LOW / MEDIUM / HIGH
 * - contact + lifecyclestage    → HubSpot's standard lifecycle values
 * - everything else             → [] (the multiselect shows "no options",
 *   admin falls back to the free-form "add custom value" input)
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

type Option = { value: string; label: string; group?: string };

interface HubSpotPipeline {
  id: string;
  label: string;
  stages?: Array<{ id: string; label: string; displayOrder?: number }>;
}
interface HubSpotPipelinesResponse {
  results?: HubSpotPipeline[];
}

async function fetchPipelineStages(
  objectTypePlural: "deals" | "tickets",
): Promise<Option[]> {
  const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!accessToken) return [];
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/pipelines/${objectTypePlural}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      next: { revalidate: 300 },
    },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as HubSpotPipelinesResponse;
  const out: Option[] = [];
  for (const p of data.results ?? []) {
    const stages = [...(p.stages ?? [])].sort(
      (a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
    );
    for (const s of stages) {
      out.push({ value: s.id, label: s.label, group: p.label });
    }
  }
  return out;
}

const STATIC_OPTIONS: Record<string, Record<string, Option[]>> = {
  contact: {
    lifecyclestage: [
      { value: "subscriber", label: "Subscriber" },
      { value: "lead", label: "Lead" },
      { value: "marketingqualifiedlead", label: "Marketing Qualified Lead" },
      { value: "salesqualifiedlead", label: "Sales Qualified Lead" },
      { value: "opportunity", label: "Opportunity" },
      { value: "customer", label: "Customer" },
      { value: "evangelist", label: "Evangelist" },
      { value: "other", label: "Other" },
    ],
    hs_lead_status: [
      { value: "NEW", label: "New" },
      { value: "OPEN", label: "Open" },
      { value: "IN_PROGRESS", label: "In Progress" },
      { value: "OPEN_DEAL", label: "Open Deal" },
      { value: "UNQUALIFIED", label: "Unqualified" },
      { value: "ATTEMPTED_TO_CONTACT", label: "Attempted to Contact" },
      { value: "CONNECTED", label: "Connected" },
      { value: "BAD_TIMING", label: "Bad Timing" },
    ],
  },
  ticket: {
    hs_ticket_priority: [
      { value: "LOW", label: "Low" },
      { value: "MEDIUM", label: "Medium" },
      { value: "HIGH", label: "High" },
    ],
  },
  deal: {
    // future: deal_type, etc.
  },
};

export async function GET(request: NextRequest) {
  if (!isAdminWorkflowsEnabled()) {
    return NextResponse.json({ error: "Feature disabled" }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const user = await getUserByEmail(session.user.email);
  if (!user?.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Admin required" }, { status: 403 });
  }

  const url = new URL(request.url);
  const objectType = url.searchParams.get("objectType") ?? "";
  const propertyName = url.searchParams.get("propertyName") ?? "";

  // Pipeline stages — network lookup
  if (objectType === "deal" && propertyName === "dealstage") {
    return NextResponse.json({ options: await fetchPipelineStages("deals") });
  }
  if (objectType === "ticket" && propertyName === "hs_pipeline_stage") {
    return NextResponse.json({ options: await fetchPipelineStages("tickets") });
  }

  // Static enum lookups
  const staticOpts = STATIC_OPTIONS[objectType]?.[propertyName];
  if (staticOpts) {
    return NextResponse.json({ options: staticOpts });
  }

  return NextResponse.json({ options: [] });
}
