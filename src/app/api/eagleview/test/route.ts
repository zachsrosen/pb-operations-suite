/**
 * /api/eagleview/test
 *
 * GET → Runs a sandbox-only diagnostic: token → availability (TDP, product 91) →
 *       place order → report status. Returns raw EagleView API responses
 *       so they can be captured in the browser Network tab as Go-Live proof.
 *
 * Auth: session via requireApiAuth (ADMIN only via middleware prefix).
 * Only runs when EAGLEVIEW_SANDBOX=true to prevent accidental production orders.
 */
import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import {
  EagleViewClient,
  EAGLEVIEW_PRODUCT_ID,
} from "@/lib/eagleview";

const TEST_ADDRESS = {
  address: "2001 Via Teca, San Clemente, California 92673, United States",
  latitude: 33.44448,
  longitude: -117.62382,
  street: "2001 Via Teca",
  city: "San Clemente",
  state: "CA",
  zip: "92673",
};

export async function GET() {
  const auth = await requireApiAuth();
  if (auth instanceof NextResponse) return auth;

  if (process.env.EAGLEVIEW_SANDBOX !== "true") {
    return NextResponse.json(
      { error: "This endpoint is sandbox-only. Set EAGLEVIEW_SANDBOX=true." },
      { status: 403 },
    );
  }

  const client = new EagleViewClient();
  if (!client.isConfigured()) {
    return NextResponse.json(
      { error: "Missing EAGLEVIEW_CLIENT_ID or EAGLEVIEW_CLIENT_SECRET", missing: client.getMissingConfig() },
      { status: 500 },
    );
  }

  const steps: Record<string, unknown> = {};

  // Step 1: Availability check (TDP — product 91)
  try {
    const avail = await client.checkSolarAvailability(
      { address: TEST_ADDRESS.address, latitude: TEST_ADDRESS.latitude, longitude: TEST_ADDRESS.longitude },
      [EAGLEVIEW_PRODUCT_ID.TDP],
    );
    steps.availability = { status: "OK", response: avail };

    const tdp = avail.availabilityStatus?.find(
      (s: { productId: number; isAvailable: boolean }) => s.productId === EAGLEVIEW_PRODUCT_ID.TDP,
    );
    if (!tdp?.isAvailable) {
      steps.availability = { status: "UNAVAILABLE", response: avail };
      return NextResponse.json({ steps, summary: "TrueDesign (Product 91) not available at test address." });
    }
  } catch (err) {
    steps.availability = { status: "ERROR", error: err instanceof Error ? err.message : String(err) };
    return NextResponse.json({ steps, summary: "Availability check failed." }, { status: 502 });
  }

  // Step 2: Place order
  try {
    const placed = await client.placeOrder({
      reportAddresses: {
        primary: {
          street: TEST_ADDRESS.street,
          city: TEST_ADDRESS.city,
          state: TEST_ADDRESS.state,
          zip: TEST_ADDRESS.zip,
          country: "United States",
        },
      },
      primaryProductId: EAGLEVIEW_PRODUCT_ID.TDP,
      deliveryProductId: 8,
      measurementInstructionType: 2,
      changesInLast4Years: false,
      latitude: TEST_ADDRESS.latitude,
      longitude: TEST_ADDRESS.longitude,
      referenceId: `pb-sandbox-test-${Date.now()}`,
    });
    steps.placeOrder = { status: "OK", response: placed };

    // Step 3: Report status
    if (placed.reportId) {
      try {
        const report = await client.getReport(placed.reportId);
        steps.reportStatus = { status: "OK", response: report };
      } catch (err) {
        steps.reportStatus = { status: "ERROR", error: err instanceof Error ? err.message : String(err) };
      }
    }
  } catch (err) {
    steps.placeOrder = { status: "ERROR", error: err instanceof Error ? err.message : String(err) };
    return NextResponse.json({ steps, summary: "Order placement failed." }, { status: 502 });
  }

  return NextResponse.json({
    steps,
    summary: "All steps passed. Integration is functional against sandbox.",
    note: "TrueDesign for Planning (Product 91) tested successfully against sandbox.",
  });
}
