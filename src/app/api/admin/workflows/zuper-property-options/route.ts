/**
 * GET /api/admin/workflows/zuper-property-options?propertyName=<name>
 *
 * Returns known values for Zuper job properties. Used by the
 * ZUPER_PROPERTY_CHANGE trigger's propertyValuesIn multiselect.
 *
 * Zuper doesn't expose a schema API for custom fields, so this is a
 * hardcoded catalog of the most common ones we've seen in webhooks.
 * Admins can still type custom values for properties not in the catalog.
 */

import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { getUserByEmail } from "@/lib/db";
import { isAdminWorkflowsEnabled } from "@/lib/inngest-client";

type Option = { value: string; label: string; group?: string };

// Known Zuper job statuses (customer-installed, from actual webhooks).
// If a value isn't here, admin uses 'add custom value'.
const ZUPER_PROPERTY_CATALOG: Record<string, Option[]> = {
  status: [
    { value: "Yet to Start", label: "Yet to Start" },
    { value: "In-Progress", label: "In-Progress" },
    { value: "On-Hold", label: "On-Hold" },
    { value: "Completed", label: "Completed" },
    { value: "Canceled", label: "Canceled" },
    { value: "Incomplete", label: "Incomplete" },
  ],
  category: [
    { value: "Installation", label: "Installation" },
    { value: "Site Survey", label: "Site Survey" },
    { value: "Pre-Sale Survey", label: "Pre-Sale Survey" },
    { value: "Inspection", label: "Inspection" },
    { value: "Service", label: "Service" },
    { value: "Roofing", label: "Roofing" },
    { value: "D&R", label: "D&R" },
  ],
  priority: [
    { value: "low", label: "Low" },
    { value: "normal", label: "Normal" },
    { value: "high", label: "High" },
    { value: "urgent", label: "Urgent" },
  ],
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

  const propertyName = new URL(request.url).searchParams.get("propertyName") ?? "";
  const options = ZUPER_PROPERTY_CATALOG[propertyName] ?? [];
  return NextResponse.json({ options });
}
