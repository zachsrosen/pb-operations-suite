/**
 * Tests for POST /api/webhooks/hubspot/property
 *
 * Covers Task 3.1 requirements (plan lines 1619–1640):
 *   1. Signature validation — invalid signatures → 401
 *   2. Unknown subscription types → skipped
 *   3. Idempotency — duplicate eventIds are processed once
 *   4. `contact.propertyChange` on address fields → onContactAddressChange
 *   5. `contact.propertyChange` on non-address fields → ignored
 *   6. `deal.creation` / `deal.propertyChange` → onDealOrTicketCreated("deal", ...)
 *   7. Feature flag off → 200, no handlers invoked
 */

import crypto from "crypto";

// ── Config ────────────────────────────────────────────────────────────────────
const TEST_SECRET = "test-secret-for-webhooks";
const TEST_URL = "http://localhost:3000/api/webhooks/hubspot/property";

// ── Mock: @vercel/functions — capture waitUntil promise so tests can await ───
const waitUntilPromises: Promise<unknown>[] = [];
const mockWaitUntil = jest.fn((p: Promise<unknown>) => {
  waitUntilPromises.push(p);
  return p;
});
jest.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => mockWaitUntil(p),
}));

async function flushWaitUntil(): Promise<void> {
  while (waitUntilPromises.length > 0) {
    const p = waitUntilPromises.shift();
    if (p) await p;
  }
}

// ── Mock: property-sync handlers ──────────────────────────────────────────────
const mockOnContactAddressChange = jest.fn(
  async (_contactId: string) => ({ status: "created" as const }),
);
const mockOnDealOrTicketCreated = jest.fn(
  async (_kind: "deal" | "ticket", _id: string) => ({ status: "associated" as const }),
);
jest.mock("@/lib/property-sync", () => ({
  onContactAddressChange: (contactId: string) => mockOnContactAddressChange(contactId),
  onDealOrTicketCreated: (kind: "deal" | "ticket", id: string) =>
    mockOnDealOrTicketCreated(kind, id),
}));

// ── Mock: Prisma IdempotencyKey ───────────────────────────────────────────────
const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
jest.mock("@/lib/db", () => ({
  prisma: {
    idempotencyKey: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// ── Mock: webhook auth — use real implementation ──────────────────────────────
jest.mock("@/lib/hubspot-webhook-auth", () => {
  const actual = jest.requireActual("@/lib/hubspot-webhook-auth");
  return actual;
});

// ── Route under test ──────────────────────────────────────────────────────────
import { POST } from "@/app/api/webhooks/hubspot/property/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

interface WebhookEvent {
  eventId: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}

function sign(body: string, timestamp: string, secret = TEST_SECRET): string {
  const source = "POST" + TEST_URL + body + timestamp;
  return crypto.createHmac("sha256", secret).update(source, "utf8").digest("base64");
}

function makeSignedRequest(events: WebhookEvent[], secret = TEST_SECRET): NextRequest {
  const body = JSON.stringify(events);
  const timestamp = String(Date.now());
  const signature = sign(body, timestamp, secret);
  return new NextRequest(TEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hubspot-signature-v3": signature,
      "x-hubspot-request-timestamp": timestamp,
    },
    body,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/hubspot/property", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    waitUntilPromises.length = 0;
    process.env.HUBSPOT_WEBHOOK_SECRET = TEST_SECRET;
    process.env.PROPERTY_SYNC_ENABLED = "true";

    // Default: no existing idempotency row
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({});
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("rejects requests with invalid signature (401)", async () => {
    const req = makeSignedRequest(
      [{ eventId: 1, subscriptionType: "contact.propertyChange", objectId: 1, propertyName: "address" }],
      "wrong-secret",
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("skips unknown subscription types and reports skipped count", async () => {
    const req = makeSignedRequest([
      { eventId: 100, subscriptionType: "company.creation", objectId: 42 },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(1);
    await flushWaitUntil();
    expect(mockOnContactAddressChange).not.toHaveBeenCalled();
    expect(mockOnDealOrTicketCreated).not.toHaveBeenCalled();
  });

  it("is idempotent on duplicate eventIds (second call does not re-invoke handler)", async () => {
    const event: WebhookEvent = {
      eventId: 9999,
      subscriptionType: "deal.creation",
      objectId: 111,
    };

    // First call: no existing key — handler runs, row gets created
    mockFindUnique.mockResolvedValueOnce(null);
    const req1 = makeSignedRequest([event]);
    await POST(req1);
    await flushWaitUntil();

    expect(mockOnDealOrTicketCreated).toHaveBeenCalledTimes(1);
    expect(mockOnDealOrTicketCreated).toHaveBeenCalledWith("deal", "111");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: "9999",
          scope: "property-sync:hubspot-webhook",
        }),
      }),
    );

    // Second call: key already exists — handler is skipped
    mockFindUnique.mockResolvedValueOnce({ id: "existing", key: "9999" });
    const req2 = makeSignedRequest([event]);
    await POST(req2);
    await flushWaitUntil();

    expect(mockOnDealOrTicketCreated).toHaveBeenCalledTimes(1); // still 1
  });

  it("dispatches contact.propertyChange on address field to onContactAddressChange", async () => {
    const req = makeSignedRequest([
      {
        eventId: 1,
        subscriptionType: "contact.propertyChange",
        objectId: 555,
        propertyName: "address",
      },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushWaitUntil();
    expect(mockOnContactAddressChange).toHaveBeenCalledWith("555");
  });

  it.each(["address", "address2", "city", "state", "zip", "country"])(
    "dispatches contact.propertyChange on %s",
    async (field) => {
      const req = makeSignedRequest([
        {
          eventId: Math.floor(Math.random() * 1_000_000),
          subscriptionType: "contact.propertyChange",
          objectId: 777,
          propertyName: field,
        },
      ]);
      await POST(req);
      await flushWaitUntil();
      expect(mockOnContactAddressChange).toHaveBeenCalledWith("777");
    },
  );

  it("ignores contact.propertyChange on firstname (address-only filter)", async () => {
    const req = makeSignedRequest([
      {
        eventId: 2,
        subscriptionType: "contact.propertyChange",
        objectId: 555,
        propertyName: "firstname",
      },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushWaitUntil();
    expect(mockOnContactAddressChange).not.toHaveBeenCalled();
  });

  it("dispatches deal.creation to onDealOrTicketCreated('deal', id)", async () => {
    const req = makeSignedRequest([
      { eventId: 3, subscriptionType: "deal.creation", objectId: 888 },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    await flushWaitUntil();
    expect(mockOnDealOrTicketCreated).toHaveBeenCalledWith("deal", "888");
  });

  it("dispatches deal.propertyChange to onDealOrTicketCreated('deal', id)", async () => {
    const req = makeSignedRequest([
      {
        eventId: 4,
        subscriptionType: "deal.propertyChange",
        objectId: 889,
        propertyName: "dealstage",
      },
    ]);
    await POST(req);
    await flushWaitUntil();
    expect(mockOnDealOrTicketCreated).toHaveBeenCalledWith("deal", "889");
  });

  it("dispatches ticket.creation to onDealOrTicketCreated('ticket', id)", async () => {
    const req = makeSignedRequest([
      { eventId: 5, subscriptionType: "ticket.creation", objectId: 444 },
    ]);
    await POST(req);
    await flushWaitUntil();
    expect(mockOnDealOrTicketCreated).toHaveBeenCalledWith("ticket", "444");
  });

  it("dispatches ticket.propertyChange to onDealOrTicketCreated('ticket', id)", async () => {
    const req = makeSignedRequest([
      {
        eventId: 6,
        subscriptionType: "ticket.propertyChange",
        objectId: 445,
        propertyName: "hs_pipeline_stage",
      },
    ]);
    await POST(req);
    await flushWaitUntil();
    expect(mockOnDealOrTicketCreated).toHaveBeenCalledWith("ticket", "445");
  });

  it("short-circuits with 200 when PROPERTY_SYNC_ENABLED is not 'true'", async () => {
    process.env.PROPERTY_SYNC_ENABLED = "false";
    const req = makeSignedRequest([
      { eventId: 7, subscriptionType: "deal.creation", objectId: 12 },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("disabled");
    await flushWaitUntil();
    expect(mockOnContactAddressChange).not.toHaveBeenCalled();
    expect(mockOnDealOrTicketCreated).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
