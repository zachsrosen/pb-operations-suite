import { NextRequest, NextResponse } from "next/server";
import { zuper } from "@/lib/zuper";
import { fetchPrimaryContactId, fetchContactById } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a phone number for a JobMarker.id. Supported prefixes:
 *   - zuperjob:<job_uid>  → Zuper job's customer phone
 *   - install:<dealId>    → HubSpot deal primary contact phone
 *
 * Other kinds (ticket, dnr, roofing, etc.) return 501 with an explanatory
 * payload — client can fall back gracefully.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const [prefix, rawRef] = id.split(":");
  const ref = (rawRef ?? "").trim();
  if (!ref) return NextResponse.json({ error: "malformed id" }, { status: 400 });

  try {
    if (prefix === "zuperjob" || prefix === "dnr" || prefix === "roofing") {
      // D&R + roofing are also Zuper-sourced with ids like "dnr:<uid>" from older builds;
      // accept "zuperjob:" as the canonical prefix and fall back to looking up raw ref.
      // We always need a job_uid.
      const jobUid = ref;
      const jobResp = await zuper.getJob(jobUid);
      if (jobResp.type !== "success" || !jobResp.data) {
        return NextResponse.json({ error: "job not found" }, { status: 404 });
      }
      const customerUid = (jobResp.data as { customer_uid?: string }).customer_uid;
      if (!customerUid) {
        return NextResponse.json({ error: "no customer on job" }, { status: 404 });
      }
      const custResp = await zuper.getCustomer(customerUid);
      if (custResp.type !== "success" || !custResp.data) {
        return NextResponse.json({ error: "customer not found" }, { status: 404 });
      }
      const phone = (custResp.data as { customer_phone?: string }).customer_phone?.trim();
      if (!phone) return NextResponse.json({ error: "no phone on customer" }, { status: 404 });
      return NextResponse.json({ phone });
    }

    if (prefix === "install" || prefix === "inspection" || prefix === "survey") {
      const contactId = await fetchPrimaryContactId(ref);
      if (!contactId) {
        return NextResponse.json({ error: "no primary contact" }, { status: 404 });
      }
      const contact = await fetchContactById(contactId, ["phone", "mobilephone"]);
      const phone = contact?.properties?.phone?.trim() || contact?.properties?.mobilephone?.trim();
      if (!phone) {
        return NextResponse.json({ error: "no phone on contact" }, { status: 404 });
      }
      return NextResponse.json({ phone });
    }

    return NextResponse.json(
      { error: `phone lookup not supported for '${prefix}' markers` },
      { status: 501 }
    );
  } catch (err) {
    console.error("[map phone] lookup failed:", err);
    return NextResponse.json({ error: "lookup failed" }, { status: 500 });
  }
}
