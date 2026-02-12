import { NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

export async function GET() {
  // Keep this endpoint off in production unless explicitly enabled.
  if (process.env.NODE_ENV === "production" && process.env.DEBUG_API_ENABLED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const user = await getUserByEmail(session.user.email);
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const results: Record<string, unknown> = {};

  // 1. Check owner resolution
  try {
    const ownersResponse = await hubspotClient.crm.owners.ownersApi.getPage(
      undefined, undefined, 10, false
    );
    results.owners = ownersResponse.results?.slice(0, 5).map(o => ({
      id: o.id,
      userId: o.userId,
      name: `${o.firstName} ${o.lastName}`,
    }));
    results.ownerCount = ownersResponse.results?.length;
  } catch (err) {
    results.ownersError = String(err);
  }

  // 2. Check site_surveyor property
  try {
    const prop = await hubspotClient.crm.properties.coreApi.getByName("deals", "site_surveyor");
    results.siteSurveyorProperty = {
      name: prop.name,
      label: prop.label,
      type: prop.type,
      fieldType: prop.fieldType,
      optionCount: prop.options?.length || 0,
      sampleOptions: prop.options?.slice(0, 10).map(o => ({
        value: o.value,
        label: o.label,
      })),
    };
  } catch (err: unknown) {
    const errObj = err as { statusCode?: number; body?: { message?: string } };
    results.siteSurveyorError = errObj.statusCode === 404
      ? "Property 'site_surveyor' does not exist"
      : String(err);
  }

  // 3. Sample a few deals
  try {
    const deals = await hubspotClient.crm.deals.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: "dealstage",
          operator: "EQ" as unknown as import("@hubspot/api-client/lib/codegen/crm/deals").FilterOperatorEnum,
          value: "59782386", // Site Survey stage
        }],
      }],
      properties: ["dealname", "hubspot_owner_id", "site_surveyor", "pb_location"],
      limit: 5,
      after: "0",
    });
    results.sampleDeals = deals.results.map(d => ({
      id: d.id,
      name: d.properties.dealname,
      hubspot_owner_id: d.properties.hubspot_owner_id,
      site_surveyor: d.properties.site_surveyor,
      pb_location: d.properties.pb_location,
    }));
  } catch (err) {
    results.dealsError = String(err);
  }

  return NextResponse.json(results);
}
