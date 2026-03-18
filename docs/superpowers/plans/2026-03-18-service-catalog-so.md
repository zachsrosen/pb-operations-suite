# Service Catalog + Service SO Creation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Service Catalog browsing page and deal-scoped Sales Order creation slide-over to complete Phase 4 of the Service Suite.

**Architecture:** Service Catalog is a read-only filtered view of `InternalProduct` (category=SERVICE) using the existing products API. SO creation is a slide-over on the service pipeline that sends `{ dealId, requestToken, items }` to a new API endpoint. The server resolves products, Zoho customer, and creates the SO in Zoho with idempotency via a `ServiceSoRequest` Prisma model. Company association data is added to the deals API to enable the "Create SO" button gating.

**Tech Stack:** Next.js 16.1, React 19, Prisma 7 (Neon Postgres), HubSpot API (associations), Zoho Inventory API (SO + customer), TypeScript 5.

**Spec:** `docs/superpowers/specs/2026-03-18-service-catalog-so-design.md`

**Known tradeoff:** Zoho customer matching uses first-match-wins when multiple customers share a company name. This is pragmatic for Phase 4's low service SO volume. If duplicate-customer issues arise, tighten the matching in a follow-up.

---

## Chunk 1: Data Layer — Prisma Model + Zoho Customer Method

### Task 1: Add ServiceSoRequest Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add enum + model at end of file)

- [ ] **Step 1: Add the enum and model to schema.prisma**

After the last model in the schema, add:

```prisma
enum ServiceSoStatus {
  DRAFT
  SUBMITTED
  FAILED
}

model ServiceSoRequest {
  id              String          @id @default(cuid())
  dealId          String
  requestToken    String          @unique
  zohoSoId        String?
  zohoSoNumber    String?
  zohoCustomerId  String?
  lineItems       Json
  totalAmount     Float
  status          ServiceSoStatus @default(DRAFT)
  errorMessage    String?
  createdBy       String
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  @@index([dealId])
  @@index([createdBy])
}
```

- [ ] **Step 2: Run migration**

Run: `npx prisma migrate dev --name add-service-so-request`
Expected: Migration creates `ServiceSoRequest` table + `ServiceSoStatus` enum.

- [ ] **Step 3: Verify generated client**

Run: `npx prisma generate`
Expected: `Generated Prisma Client` message.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add ServiceSoRequest model and ServiceSoStatus enum"
```

---

### Task 2: Add `createContact()` method to zoho-inventory.ts

The Zoho Inventory client has no customer creation method. Add one using the Zoho Contacts API.

**Files:**
- Modify: `src/lib/zoho-inventory.ts` (add method to `ZohoInventoryClient` class)
- Test: `src/__tests__/lib/zoho-inventory-create-contact.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// src/__tests__/lib/zoho-inventory-create-contact.test.ts
import { zohoInventory } from "@/lib/zoho-inventory";

// Mock the private request method
const mockRequestPost = jest.fn();
jest.spyOn(zohoInventory as unknown as { requestPost: unknown }, "requestPost")
  .mockImplementation(mockRequestPost);

describe("createContact", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates a customer contact and returns contact_id", async () => {
    mockRequestPost.mockResolvedValue({
      code: 0,
      contact: { contact_id: "zc-123", contact_name: "Acme Corp" },
    });

    const result = await zohoInventory.createContact({
      contact_name: "Acme Corp",
      email: "info@acme.com",
      contact_type: "customer",
    });

    expect(result).toEqual({ contact_id: "zc-123" });
    expect(mockRequestPost).toHaveBeenCalledWith("/contacts", {
      contact_name: "Acme Corp",
      email: "info@acme.com",
      contact_type: "customer",
    });
  });

  it("throws when Zoho returns no contact_id", async () => {
    mockRequestPost.mockResolvedValue({ code: 1, message: "Invalid data" });
    await expect(
      zohoInventory.createContact({
        contact_name: "Bad Corp",
        contact_type: "customer",
      })
    ).rejects.toThrow("Zoho did not return a contact ID");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/lib/zoho-inventory-create-contact.test.ts --no-coverage`
Expected: FAIL — `createContact` is not a function.

- [ ] **Step 3: Add the method to ZohoInventoryClient**

In `src/lib/zoho-inventory.ts`, add inside the `ZohoInventoryClient` class (after `createSalesOrder`):

```typescript
  /**
   * Create a new contact (customer) in Zoho Inventory.
   * Used by service SO creation when the deal's company has no Zoho match.
   */
  async createContact(payload: {
    contact_name: string;
    email?: string;
    contact_type: "customer" | "vendor";
  }): Promise<{ contact_id: string }> {
    const result = await this.requestPost<{
      code?: number;
      message?: string;
      contact?: { contact_id: string; contact_name: string };
    }>("/contacts", payload);

    if (!result.contact?.contact_id) {
      throw new Error(result.message ?? "Zoho did not return a contact ID");
    }

    return { contact_id: result.contact.contact_id };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/__tests__/lib/zoho-inventory-create-contact.test.ts --no-coverage`
Expected: 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/zoho-inventory.ts src/__tests__/lib/zoho-inventory-create-contact.test.ts
git commit -m "feat: add createContact() method to Zoho Inventory client"
```

---

## Chunk 2: SO Creation Business Logic

### Task 3: Create service-so-create.ts — types + Zoho customer resolution

The core SO creation module. This task adds types, the Zoho customer lookup (paginated `fetchCustomerPage` loop capped at 5 pages), and customer creation fallback.

**Files:**
- Create: `src/lib/service-so-create.ts`
- Test: `src/__tests__/lib/service-so-create.test.ts`

- [ ] **Step 1: Write tests for resolveZohoCustomer**

```typescript
// src/__tests__/lib/service-so-create.test.ts
jest.mock("@/lib/zoho-inventory", () => ({
  zohoInventory: {
    fetchCustomerPage: jest.fn(),
    createContact: jest.fn(),
  },
}));

jest.mock("@sentry/nextjs", () => ({
  captureException: jest.fn(),
}));

import { resolveZohoCustomer } from "@/lib/service-so-create";
import { zohoInventory } from "@/lib/zoho-inventory";

const mockFetchPage = zohoInventory.fetchCustomerPage as jest.Mock;
const mockCreateContact = zohoInventory.createContact as jest.Mock;

describe("resolveZohoCustomer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns customer_id when exact name match found on page 1", async () => {
    mockFetchPage.mockResolvedValueOnce({
      contacts: [
        { contact_id: "zc-1", contact_name: "Acme Corp" },
        { contact_id: "zc-2", contact_name: "Beta Inc" },
      ],
      hasMore: false,
    });

    const result = await resolveZohoCustomer("Acme Corp", "info@acme.com");
    expect(result).toBe("zc-1");
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
  });

  it("paginates up to 5 pages to find a match", async () => {
    for (let i = 0; i < 4; i++) {
      mockFetchPage.mockResolvedValueOnce({ contacts: [{ contact_id: `zc-${i}`, contact_name: `Other ${i}` }], hasMore: true });
    }
    mockFetchPage.mockResolvedValueOnce({
      contacts: [{ contact_id: "zc-found", contact_name: "Target Co" }],
      hasMore: false,
    });

    const result = await resolveZohoCustomer("Target Co");
    expect(result).toBe("zc-found");
    expect(mockFetchPage).toHaveBeenCalledTimes(5);
  });

  it("creates customer when no match found within 5 pages", async () => {
    for (let i = 0; i < 5; i++) {
      mockFetchPage.mockResolvedValueOnce({ contacts: [{ contact_id: `zc-${i}`, contact_name: `Other ${i}` }], hasMore: true });
    }
    mockCreateContact.mockResolvedValueOnce({ contact_id: "zc-new" });

    const result = await resolveZohoCustomer("NewCo", "admin@newco.com");
    expect(result).toBe("zc-new");
    expect(mockCreateContact).toHaveBeenCalledWith({
      contact_name: "NewCo",
      email: "admin@newco.com",
      contact_type: "customer",
    });
  });

  it("uses first match and logs warning when multiple matches exist", async () => {
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation();
    mockFetchPage.mockResolvedValueOnce({
      contacts: [
        { contact_id: "zc-a", contact_name: "Dupes Inc" },
        { contact_id: "zc-b", contact_name: "Dupes Inc" },
      ],
      hasMore: false,
    });

    const result = await resolveZohoCustomer("Dupes Inc");
    expect(result).toBe("zc-a");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Multiple Zoho customers matched")
    );
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/service-so-create.test.ts --no-coverage`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement types + resolveZohoCustomer**

```typescript
// src/lib/service-so-create.ts
/**
 * Service SO Creation Module
 *
 * Handles product resolution, Zoho customer lookup, and SO creation
 * for the service pipeline. Idempotent via ServiceSoRequest.requestToken.
 *
 * Spec: docs/superpowers/specs/2026-03-18-service-catalog-so-design.md
 */

import * as Sentry from "@sentry/nextjs";
import { zohoInventory } from "@/lib/zoho-inventory";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CUSTOMER_LOOKUP_MAX_PAGES = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceSoLineItem {
  productId: string;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  zohoItemId: string | null;
}

export interface CreateServiceSoInput {
  dealId: string;
  dealName: string;
  dealAddress: string;
  requestToken: string;
  items: Array<{ productId: string; quantity: number }>;
  createdBy: string; // user email
}

export interface CreateServiceSoResult {
  zohoSoId: string;
  zohoSoNumber: string;
  zohoCustomerId: string;
  lineItems: ServiceSoLineItem[];
  totalAmount: number;
  alreadyExisted?: boolean;
}

// ---------------------------------------------------------------------------
// Zoho Customer Resolution
// ---------------------------------------------------------------------------

/**
 * Find or create a Zoho customer by company name.
 *
 * Paginates through fetchCustomerPage (max 5 pages / 1000 customers).
 * If no match found, creates a new customer in Zoho.
 * If multiple matches, uses first match + logs warning (pragmatic for Phase 4).
 */
export async function resolveZohoCustomer(
  companyName: string,
  contactEmail?: string
): Promise<string> {
  const matches: Array<{ contact_id: string; contact_name: string }> = [];

  for (let page = 1; page <= CUSTOMER_LOOKUP_MAX_PAGES; page++) {
    try {
      const { contacts, hasMore } = await zohoInventory.fetchCustomerPage(page);

      for (const c of contacts) {
        if (c.contact_name?.toLowerCase() === companyName.toLowerCase()) {
          matches.push({ contact_id: c.contact_id, contact_name: c.contact_name });
        }
      }

      // Short-circuit if we found at least one match or no more pages
      if (matches.length > 0 || !hasMore) break;
    } catch (err) {
      Sentry.captureException(err);
      console.error(`[ServiceSO] Customer page ${page} fetch failed:`, err);
      break;
    }
  }

  if (matches.length === 1) {
    return matches[0].contact_id;
  }

  if (matches.length > 1) {
    console.warn(
      `[ServiceSO] Multiple Zoho customers matched "${companyName}": ${matches.map(m => m.contact_id).join(", ")}. Using first match.`
    );
    return matches[0].contact_id;
  }

  // No match — warn about cap and create new customer
  console.warn(
    `[ServiceSO] No Zoho customer matched "${companyName}" within ${CUSTOMER_LOOKUP_MAX_PAGES} pages. Creating new customer.`
  );

  const { contact_id } = await zohoInventory.createContact({
    contact_name: companyName,
    email: contactEmail,
    contact_type: "customer",
  });

  return contact_id;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/service-so-create.test.ts --no-coverage`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/service-so-create.ts src/__tests__/lib/service-so-create.test.ts
git commit -m "feat: add service SO types and Zoho customer resolution"
```

---

### Task 4: Add product resolution + SO creation to service-so-create.ts

This adds the main `createServiceSo()` function that resolves products from the database, creates the Zoho SO, and manages the `ServiceSoRequest` record with idempotency.

**Files:**
- Modify: `src/lib/service-so-create.ts`
- Modify: `src/__tests__/lib/service-so-create.test.ts`

- [ ] **Step 1: Add tests for createServiceSo**

Append to the existing test file:

```typescript
import { createServiceSo, type CreateServiceSoInput } from "@/lib/service-so-create";
import { prisma } from "@/lib/db";

// Mock Prisma
jest.mock("@/lib/db", () => ({
  prisma: {
    internalProduct: { findMany: jest.fn() },
    serviceSoRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock HubSpot
jest.mock("@/lib/hubspot", () => ({
  hubspotClient: {
    crm: {
      associations: { batchApi: { read: jest.fn() } },
      companies: { batchApi: { read: jest.fn() } },
      contacts: { batchApi: { read: jest.fn() } },
    },
  },
}));

import { hubspotClient } from "@/lib/hubspot";

const mockProductFind = prisma.internalProduct.findMany as jest.Mock;
const mockSoCreate = prisma.serviceSoRequest.create as jest.Mock;
const mockSoFindUnique = prisma.serviceSoRequest.findUnique as jest.Mock;
const mockSoUpdate = prisma.serviceSoRequest.update as jest.Mock;
const mockAssocRead = hubspotClient.crm.associations.batchApi.read as jest.Mock;
const mockCompanyRead = hubspotClient.crm.companies.batchApi.read as jest.Mock;
const mockContactRead = hubspotClient.crm.contacts.batchApi.read as jest.Mock;

const mockCreateSo = jest.fn();
jest.spyOn(zohoInventory, "createSalesOrder").mockImplementation(mockCreateSo);

describe("createServiceSo", () => {
  const baseInput: CreateServiceSoInput = {
    dealId: "deal-1",
    dealName: "Test Service Deal",
    dealAddress: "123 Main St, Denver, CO 80202",
    requestToken: "tok-abc",
    items: [{ productId: "prod-1", quantity: 2 }],
    createdBy: "user@example.com",
  };

  beforeEach(() => jest.clearAllMocks());

  it("returns existing result on idempotency hit (P2002)", async () => {
    // Simulate unique constraint violation on create
    mockSoCreate.mockRejectedValueOnce({ code: "P2002" });
    mockSoFindUnique.mockResolvedValueOnce({
      id: "req-1",
      zohoSoId: "zso-1",
      zohoSoNumber: "SO-001",
      zohoCustomerId: "zc-1",
      lineItems: [{ productId: "prod-1", name: "Widget", sku: "W-1", quantity: 2, unitPrice: 50 }],
      totalAmount: 100,
      status: "SUBMITTED",
    });

    const result = await createServiceSo(baseInput);
    expect(result.alreadyExisted).toBe(true);
    expect(result.zohoSoId).toBe("zso-1");
    expect(mockCreateSo).not.toHaveBeenCalled();
  });

  it("creates SO with resolved products and updates record", async () => {
    // DRAFT record created
    mockSoCreate.mockResolvedValueOnce({ id: "req-2" });

    // Product resolution
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1",
      name: "Service Widget",
      sku: "SW-100",
      sellPrice: 75.00,
      category: "SERVICE",
      isActive: true,
      zohoItemId: "zi-1",
    }]);

    // HubSpot: deal → company association
    mockAssocRead.mockResolvedValueOnce({
      results: [{ _from: { id: "deal-1" }, to: [{ id: "comp-1" }] }],
    });
    // Company properties
    mockCompanyRead.mockResolvedValueOnce({
      results: [{ id: "comp-1", properties: { name: "Acme Corp", domain: "acme.com" } }],
    });
    // Primary contact for email
    // (deal → contact association for email fallback)
    mockAssocRead.mockResolvedValueOnce({
      results: [{ _from: { id: "deal-1" }, to: [{ id: "cont-1" }] }],
    });
    mockContactRead.mockResolvedValueOnce({
      results: [{ id: "cont-1", properties: { email: "info@acme.com" } }],
    });

    // Zoho customer lookup — exact match
    mockFetchPage.mockResolvedValueOnce({
      contacts: [{ contact_id: "zc-acme", contact_name: "Acme Corp" }],
      hasMore: false,
    });

    // Zoho SO creation
    mockCreateSo.mockResolvedValueOnce({
      salesorder_id: "zso-new",
      salesorder_number: "SO-099",
    });

    // Update record on success
    mockSoUpdate.mockResolvedValueOnce({});

    const result = await createServiceSo(baseInput);
    expect(result.zohoSoId).toBe("zso-new");
    expect(result.zohoSoNumber).toBe("SO-099");
    expect(result.totalAmount).toBe(150); // 75 * 2
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0].name).toBe("Service Widget");
  });

  it("rejects when product is not SERVICE category", async () => {
    mockSoCreate.mockResolvedValueOnce({ id: "req-3" });
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1",
      name: "Solar Panel",
      category: "MODULE",
      isActive: true,
    }]);

    await expect(createServiceSo(baseInput)).rejects.toThrow(
      /not valid SERVICE products/
    );
  });

  it("rejects when deal has no company association", async () => {
    mockSoCreate.mockResolvedValueOnce({ id: "req-4" });
    mockProductFind.mockResolvedValueOnce([{
      id: "prod-1", name: "Widget", category: "SERVICE", isActive: true,
      sku: null, sellPrice: 50, zohoItemId: null,
    }]);
    mockAssocRead.mockResolvedValueOnce({ results: [] });

    await expect(createServiceSo(baseInput)).rejects.toThrow(
      /must have an associated company/
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/lib/service-so-create.test.ts --no-coverage`
Expected: FAIL — `createServiceSo` not found.

- [ ] **Step 3: Implement createServiceSo**

Add to `src/lib/service-so-create.ts` after the existing code:

```typescript
import { prisma } from "@/lib/db";
import { hubspotClient } from "@/lib/hubspot";
import type { ZohoSalesOrderLineItem } from "@/lib/zoho-inventory";

// ---------------------------------------------------------------------------
// HubSpot Helpers
// ---------------------------------------------------------------------------

async function resolveCompanyForDeal(
  dealId: string
): Promise<{ companyId: string; companyName: string; contactEmail?: string }> {
  // Deal → company association
  const assocResp = await hubspotClient.crm.associations.batchApi.read(
    "deals",
    "companies",
    { inputs: [{ id: dealId }] }
  );
  const companyIds = (assocResp.results?.[0]?.to || []).map(
    (t: { id: string }) => t.id
  );
  if (companyIds.length === 0) {
    throw new Error("Deal must have an associated company to create a Sales Order");
  }

  // Fetch company properties
  const companyResp = await hubspotClient.crm.companies.batchApi.read({
    inputs: [{ id: companyIds[0] }],
    properties: ["name", "domain"],
    propertiesWithHistory: [],
  });
  const company = companyResp.results?.[0];
  const companyName = company?.properties?.name || `Company ${companyIds[0]}`;

  // Fetch primary contact email (for Zoho customer creation fallback)
  let contactEmail: string | undefined;
  try {
    const contactAssocResp = await hubspotClient.crm.associations.batchApi.read(
      "deals",
      "contacts",
      { inputs: [{ id: dealId }] }
    );
    const contactIds = (contactAssocResp.results?.[0]?.to || []).map(
      (t: { id: string }) => t.id
    );
    if (contactIds.length > 0) {
      const contactResp = await hubspotClient.crm.contacts.batchApi.read({
        inputs: [{ id: contactIds[0] }],
        properties: ["email"],
        propertiesWithHistory: [],
      });
      contactEmail = contactResp.results?.[0]?.properties?.email || undefined;
    }
  } catch {
    // Non-critical — email is optional for customer creation
  }

  return { companyId: companyIds[0], companyName, contactEmail };
}

// ---------------------------------------------------------------------------
// Product Resolution
// ---------------------------------------------------------------------------

function resolveProducts(
  dbProducts: Array<{
    id: string;
    name: string | null;
    sku: string | null;
    description: string | null;
    sellPrice: number | null;
    category: string;
    isActive: boolean;
    zohoItemId: string | null;
  }>,
  requestedItems: Array<{ productId: string; quantity: number }>
): ServiceSoLineItem[] {
  const productMap = new Map(dbProducts.map(p => [p.id, p]));
  const invalid: string[] = [];

  const lineItems: ServiceSoLineItem[] = [];
  for (const item of requestedItems) {
    const product = productMap.get(item.productId);
    if (!product || product.category !== "SERVICE" || !product.isActive) {
      invalid.push(item.productId);
      continue;
    }
    lineItems.push({
      productId: product.id,
      name: product.name || "Unnamed Product",
      sku: product.sku,
      description: product.description,
      quantity: item.quantity,
      unitPrice: product.sellPrice || 0,
      zohoItemId: product.zohoItemId,
    });
  }

  if (invalid.length > 0) {
    throw new Error(
      `The following product IDs are not valid SERVICE products: ${invalid.join(", ")}`
    );
  }

  return lineItems;
}

// ---------------------------------------------------------------------------
// Main: Create Service SO
// ---------------------------------------------------------------------------

export async function createServiceSo(
  input: CreateServiceSoInput
): Promise<CreateServiceSoResult> {
  const { dealId, dealName, dealAddress, requestToken, items, createdBy } = input;

  // 1. Idempotency: check for existing record first, then create.
  //    Handles: SUBMITTED (return), FAILED (delete + retry), DRAFT (reject concurrent).
  const existing = await prisma!.serviceSoRequest.findUnique({
    where: { requestToken },
  });

  if (existing) {
    if (existing.zohoSoId) {
      // Already submitted successfully — return idempotent result
      return {
        zohoSoId: existing.zohoSoId,
        zohoSoNumber: existing.zohoSoNumber || "",
        zohoCustomerId: existing.zohoCustomerId || "",
        lineItems: existing.lineItems as ServiceSoLineItem[],
        totalAmount: existing.totalAmount,
        alreadyExisted: true,
      };
    }
    if (existing.status === "FAILED") {
      // Allow retry: delete the failed record, create fresh below
      await prisma!.serviceSoRequest.delete({ where: { requestToken } });
    } else {
      // DRAFT = concurrent request in progress
      throw new Error(
        `Service SO request already in progress (status: ${existing.status})`
      );
    }
  }

  // Create DRAFT record. The @unique constraint on requestToken still guards
  // against the narrow race between findUnique and create (P2002 → 409).
  let requestId: string;
  try {
    const record = await prisma!.serviceSoRequest.create({
      data: {
        dealId,
        requestToken,
        lineItems: [],
        totalAmount: 0,
        status: "DRAFT",
        createdBy,
      },
    });
    requestId = record.id;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
      throw new Error("Service SO request already in progress (concurrent create)");
    }
    throw err;
  }

  try {
    // 2. Resolve products from DB
    const productIds = items.map(i => i.productId);
    const dbProducts = await prisma!.internalProduct.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true, name: true, sku: true, description: true, sellPrice: true,
        category: true, isActive: true, zohoItemId: true,
      },
    });

    const lineItems = resolveProducts(dbProducts, items);
    const totalAmount = lineItems.reduce(
      (sum, li) => sum + li.unitPrice * li.quantity, 0
    );

    // 3. Resolve HubSpot company → Zoho customer
    const { companyName, contactEmail } = await resolveCompanyForDeal(dealId);
    const zohoCustomerId = await resolveZohoCustomer(companyName, contactEmail);

    // 4. Update DRAFT record with resolved data
    await prisma!.serviceSoRequest.update({
      where: { id: requestId },
      data: { lineItems: lineItems as unknown as Record<string, unknown>[], totalAmount, zohoCustomerId },
    });

    // 5. Build + send Zoho SO
    const zohoLineItems: ZohoSalesOrderLineItem[] = lineItems.map(li => ({
      ...(li.zohoItemId ? { item_id: li.zohoItemId } : {}),
      name: li.name,
      quantity: li.quantity,
      ...(li.description ? { description: li.description } : {}),
    }));

    const refNumber = dealName.length > 50 ? dealName.slice(0, 50) : dealName;

    const zohoResult = await zohoInventory.createSalesOrder({
      customer_id: zohoCustomerId,
      reference_number: refNumber,
      notes: `Service SO for ${dealAddress}`,
      status: "draft",
      line_items: zohoLineItems,
      custom_fields: [{ label: "HubSpot Deal ID", value: dealId }],
    });

    // 6. Update record → SUBMITTED
    await prisma!.serviceSoRequest.update({
      where: { id: requestId },
      data: {
        zohoSoId: zohoResult.salesorder_id,
        zohoSoNumber: zohoResult.salesorder_number,
        status: "SUBMITTED",
      },
    });

    return {
      zohoSoId: zohoResult.salesorder_id,
      zohoSoNumber: zohoResult.salesorder_number,
      zohoCustomerId,
      lineItems,
      totalAmount,
    };
  } catch (err) {
    // Update record → FAILED
    try {
      await prisma!.serviceSoRequest.update({
        where: { id: requestId },
        data: {
          status: "FAILED",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // Best-effort status update
    }
    throw err;
  }
}
```

**Note:** Move the `import { prisma } from "@/lib/db"` and `import { hubspotClient } from "@/lib/hubspot"` to the top-level imports at the beginning of the file. Also add `import type { ZohoSalesOrderLineItem } from "@/lib/zoho-inventory"` to the existing zoho import.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/lib/service-so-create.test.ts --no-coverage`
Expected: 8 passing tests (4 from Task 3 + 4 new).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep service-so-create`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/service-so-create.ts src/__tests__/lib/service-so-create.test.ts
git commit -m "feat: add product resolution and SO creation for service deals"
```

---

## Chunk 3: API Routes + Company Data Extension

### Task 5: Add company association data to service deals API

The service pipeline's `Deal` type needs `companyId` and `companyName` so the "Create SO" button can be conditionally enabled.

**Files:**
- Modify: `src/app/api/deals/route.ts` (add company batch lookup for service pipeline)

- [ ] **Step 1: Read the current deals route**

Read `src/app/api/deals/route.ts` and find:
- The `Deal` interface (add `companyId: string | null` and `companyName: string | null`)
- The section where deals are transformed after HubSpot fetch (add company association batch lookup, scoped to `pipeline === "service"` only to avoid adding latency to the solar pipeline)

- [ ] **Step 2: Add company fields to Deal interface**

In the `Deal` interface, add:
```typescript
  companyId: string | null;
  companyName: string | null;
```

- [ ] **Step 3: Add company batch lookup after deal transformation**

After deals are fetched and transformed, add (only for service pipeline):

```typescript
// Resolve company associations for service deals (needed for SO creation gating)
if (pipeline === "service" && transformedDeals.length > 0) {
  const dealIds = transformedDeals.map(d => String(d.id));
  const companyMap = new Map<string, { companyId: string; companyName: string }>();

  try {
    for (const batch of chunk(dealIds, 100)) {
      const assocResp = await hubspotClient.crm.associations.batchApi.read(
        "deals", "companies",
        { inputs: batch.map(id => ({ id })) }
      );

      const companyIds = new Set<string>();
      const dealToCompany = new Map<string, string>();

      for (const result of assocResp.results || []) {
        const dealId = result._from?.id;
        const firstCompanyId = (result.to || [])[0]?.id;
        if (dealId && firstCompanyId) {
          dealToCompany.set(dealId, firstCompanyId);
          companyIds.add(firstCompanyId);
        }
      }

      if (companyIds.size > 0) {
        const companyResp = await hubspotClient.crm.companies.batchApi.read({
          inputs: Array.from(companyIds).map(id => ({ id })),
          properties: ["name"],
          propertiesWithHistory: [],
        });
        const nameMap = new Map<string, string>();
        for (const c of companyResp.results || []) {
          nameMap.set(c.id, c.properties?.name || "");
        }
        for (const [dealId, compId] of dealToCompany) {
          companyMap.set(dealId, {
            companyId: compId,
            companyName: nameMap.get(compId) || "",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[Deals] Company association lookup failed:", err);
  }

  // Merge into transformed deals
  for (const deal of transformedDeals) {
    const company = companyMap.get(String(deal.id));
    deal.companyId = company?.companyId || null;
    deal.companyName = company?.companyName || null;
  }
}
```

Import `chunk` from `@/lib/utils` if not already imported. **Do not import `hubspotClient` from `@/lib/hubspot`** — both deals routes (`route.ts` and `stream/route.ts`) create their own local `hubspotClient` instances. Use the existing local client for the batch association calls.

- [ ] **Step 4: Default companyId/companyName to null for non-service pipelines**

In the deal transformation section, ensure non-service pipelines still get null values:
```typescript
companyId: null,
companyName: null,
```

- [ ] **Step 5: Apply same change to the stream route (CRITICAL)**

Read `src/app/api/deals/stream/route.ts` carefully. The service pipeline page uses `useProgressiveDeals` which hits `/api/deals/stream`, NOT `/api/deals`. The stream route has both a fast cache path and a slow streaming path.

**Important:** The company lookup must be applied to BOTH paths:
- **Cold cache / streaming path:** Add company batch lookup after each batch of deals is transformed, before sending the NDJSON chunk.
- **Fast cache path:** The cache stores serialized deal arrays. After adding company fields, the cached data from before this change won't have `companyId`/`companyName`. Either: (a) add a cache version bump so old entries are invalidated, or (b) add the company lookup as a post-cache enrichment step on the fast path too.

The stream route uses its own local `hubspotClient` (not imported from `@/lib/hubspot`). Use the existing local client for the batch association calls.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "deals/route\|deals/stream"`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/deals/route.ts src/app/api/deals/stream/route.ts
git commit -m "feat: add company association data to service pipeline deals"
```

---

### Task 6: Create the SO creation API endpoint

**Files:**
- Create: `src/app/api/service/create-so/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/service/create-so/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/api-auth";
import { createServiceSo } from "@/lib/service-so-create";

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApiAuth();
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const { dealId, dealName, dealAddress, requestToken, items } = body;

    // Validate required fields
    if (!dealId || !requestToken || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "dealId, requestToken, and items[] are required" },
        { status: 400 }
      );
    }

    // Validate item shape
    for (const item of items) {
      if (!item.productId || typeof item.quantity !== "number" || item.quantity < 1) {
        return NextResponse.json(
          { error: "Each item must have productId and quantity >= 1" },
          { status: 400 }
        );
      }
    }

    const result = await createServiceSo({
      dealId: String(dealId),
      dealName: dealName || "",
      dealAddress: dealAddress || "",
      requestToken,
      items,
      createdBy: authResult.email,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[CreateServiceSO] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to create service SO";
    const status = message.includes("must have an associated company") ? 400
      : message.includes("not valid SERVICE products") ? 400
      : message.includes("already exists with status") ? 409
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep create-so`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/service/create-so/route.ts
git commit -m "feat: add POST /api/service/create-so endpoint"
```

---

## Chunk 4: UI — Service Catalog Page + SO Slide-Over

### Task 7: Create the Service Catalog browsing page

**Files:**
- Create: `src/app/dashboards/service-catalog/page.tsx`

- [ ] **Step 1: Create the page**

Build a `DashboardShell`-wrapped page that:
- Fetches `GET /api/inventory/products?category=SERVICE&active=true` (default) or `active=false` when "Show Inactive" is toggled
- Renders a table: Name, Brand/Model, Description, SKU, Sell Price, Active Status
- Text search filter (client-side, filters on name/sku/brand/model)
- "Show Inactive" toggle
- ADMIN-only: "Add Product" button (links to `/dashboards/catalog/new?category=SERVICE`), "Edit" link per row (links to `/dashboards/catalog/edit/{id}`)
- Role check: use `session.user` role from the page's auth call

Key implementation notes:
- Use `DashboardShell` with `accentColor="cyan"` and `title="Service Catalog"`
- Use `bg-surface` for table, `text-foreground` for text, theme tokens throughout
- Admin role check: `["ADMIN"].includes(user.role)`
- Inactive rows: `opacity-50` with "Inactive" badge
- Format sell price with `formatCurrency()` from `@/lib/format`

- [ ] **Step 2: Verify page loads**

Run: `npm run build 2>&1 | grep -E "service-catalog|error"`
Expected: Build succeeds, `/dashboards/service-catalog` compiled.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboards/service-catalog/page.tsx
git commit -m "feat: add Service Catalog browsing page"
```

---

### Task 8: Add SO creation slide-over to service pipeline

This is the largest UI task. Adds a "Create SO" button per deal row and a slide-over panel with product picker + line item review + submit.

**Files:**
- Modify: `src/app/dashboards/service/page.tsx`

- [ ] **Step 1: Update the Deal type**

Add to the `Deal` interface in the service page:
```typescript
  companyId: string | null;
  companyName: string | null;
```

- [ ] **Step 2: Add state for the SO slide-over**

```typescript
const [soSelectedDeal, setSoSelectedDeal] = useState<Deal | null>(null);
const [soProducts, setSoProducts] = useState<Product[]>([]);
const [soLineItems, setSoLineItems] = useState<LineItem[]>([]);
const [soLoading, setSoLoading] = useState(false);
const [soSubmitting, setSoSubmitting] = useState(false);
const [soResult, setSoResult] = useState<SoResult | null>(null);
const [soError, setSoError] = useState<string | null>(null);
const [soProductSearch, setSoProductSearch] = useState("");
const soRequestTokenRef = useRef<string | null>(null);
```

With types:
```typescript
interface Product {
  id: string;
  name: string;
  sku: string | null;
  sellPrice: number | null;
}

interface LineItem {
  productId: string;
  name: string;
  sku: string | null;
  unitPrice: number;
  quantity: number;
}

interface SoResult {
  zohoSoId: string;
  zohoSoNumber: string;
  totalAmount: number;
  alreadyExisted?: boolean;
}
```

- [ ] **Step 3: Add "Create SO" button to deal table rows**

In the deal row's actions column, add a button before the existing "Open →" link:

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    handleOpenSoPanel(deal);
  }}
  disabled={!deal.companyId}
  title={deal.companyId ? "Create Sales Order" : "Deal must have an associated company to create a Sales Order"}
  className={`text-sm px-2 py-1 rounded ${
    deal.companyId
      ? "text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
      : "text-muted/40 cursor-not-allowed"
  }`}
>
  Create SO
</button>
```

- [ ] **Step 4: Add handleOpenSoPanel function**

```typescript
const handleOpenSoPanel = useCallback(async (deal: Deal) => {
  soRequestTokenRef.current = crypto.randomUUID(); // stable for this panel session
  setSoSelectedDeal(deal);
  setSoLineItems([]);
  setSoResult(null);
  setSoError(null);
  setSoProductSearch("");
  setSoLoading(true);

  try {
    const res = await fetch("/api/inventory/products?category=SERVICE&active=true");
    if (!res.ok) throw new Error("Failed to load products");
    const data = await res.json();
    setSoProducts(
      (data.products || []).map((p: Record<string, unknown>) => ({
        id: p.id as string,
        name: (p.name || p.model || "Unnamed") as string,
        sku: p.sku as string | null,
        sellPrice: p.sellPrice as number | null,
      }))
    );
  } catch {
    setSoError("Failed to load service products");
  } finally {
    setSoLoading(false);
  }
}, []);
```

- [ ] **Step 5: Add the slide-over panel JSX**

After the table `</div>`, add the slide-over (same pattern as service-tickets):

```tsx
{soSelectedDeal && (
  <div className="fixed inset-0 z-50 flex justify-end">
    <div className="absolute inset-0 bg-black/40" onClick={() => setSoSelectedDeal(null)} />
    <div className="relative w-full max-w-lg bg-surface border-l border-t-border overflow-y-auto">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Create Sales Order</h2>
            <p className="text-sm text-muted">{soSelectedDeal.name}</p>
            <p className="text-xs text-muted">{soSelectedDeal.address}</p>
          </div>
          <button onClick={() => setSoSelectedDeal(null)} className="text-muted hover:text-foreground">✕</button>
        </div>

        {soResult ? (
          /* Success state */
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
            <p className="text-green-400 font-medium">
              {soResult.alreadyExisted ? "Sales Order already exists" : "Sales Order created"}
            </p>
            <p className="text-sm text-muted mt-1">SO #: {soResult.zohoSoNumber}</p>
            <p className="text-sm text-muted">Total: {formatCurrency(soResult.totalAmount)}</p>
          </div>
        ) : (
          <>
            {/* Product picker */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="Search products..."
                value={soProductSearch}
                onChange={(e) => setSoProductSearch(e.target.value)}
                className="w-full px-3 py-2 bg-surface-2 border border-t-border rounded text-sm text-foreground"
              />
            </div>

            {soLoading ? (
              <LoadingSpinner color="cyan" message="Loading products..." />
            ) : (
              <div className="max-h-48 overflow-y-auto mb-4 border border-t-border rounded">
                {soProducts
                  .filter(p => {
                    const q = soProductSearch.toLowerCase();
                    return !q || p.name.toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q);
                  })
                  .map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        if (!soLineItems.find(li => li.productId === p.id)) {
                          setSoLineItems(prev => [...prev, {
                            productId: p.id,
                            name: p.name,
                            sku: p.sku,
                            unitPrice: p.sellPrice || 0,
                            quantity: 1,
                          }]);
                        }
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-t-border last:border-b-0"
                    >
                      <div className="text-sm text-foreground">{p.name}</div>
                      <div className="text-xs text-muted">{p.sku || "No SKU"} · {formatCurrency(p.sellPrice || 0)}</div>
                    </button>
                  ))}
              </div>
            )}

            {/* Line items */}
            {soLineItems.length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-medium text-foreground mb-2">Line Items</h3>
                {soLineItems.map((li, idx) => (
                  <div key={li.productId} className="flex items-center gap-2 mb-2 p-2 bg-surface-2 rounded">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground truncate">{li.name}</div>
                      <div className="text-xs text-muted">{formatCurrency(li.unitPrice)} each</div>
                    </div>
                    <input
                      type="number"
                      min={1}
                      value={li.quantity}
                      onChange={(e) => {
                        const qty = Math.max(1, parseInt(e.target.value) || 1);
                        setSoLineItems(prev => prev.map((item, i) => i === idx ? { ...item, quantity: qty } : item));
                      }}
                      className="w-16 px-2 py-1 bg-surface border border-t-border rounded text-sm text-foreground text-center"
                    />
                    <div className="w-20 text-right text-sm text-foreground">
                      {formatCurrency(li.unitPrice * li.quantity)}
                    </div>
                    <button
                      onClick={() => setSoLineItems(prev => prev.filter((_, i) => i !== idx))}
                      className="text-red-400 hover:text-red-300 text-sm"
                    >✕</button>
                  </div>
                ))}
                <div className="text-right text-sm font-medium text-foreground mt-2">
                  Total: {formatCurrency(soLineItems.reduce((sum, li) => sum + li.unitPrice * li.quantity, 0))}
                </div>
              </div>
            )}

            {/* Submit */}
            {soError && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                {soError}
              </div>
            )}
            <button
              onClick={handleSubmitSo}
              disabled={soLineItems.length === 0 || soSubmitting}
              className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium"
            >
              {soSubmitting ? "Creating..." : "Create Sales Order"}
            </button>
          </>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 6: Add handleSubmitSo function**

```typescript
const handleSubmitSo = useCallback(async () => {
  if (!soSelectedDeal || soLineItems.length === 0 || !soRequestTokenRef.current) return;
  setSoSubmitting(true);
  setSoError(null);

  const requestToken = soRequestTokenRef.current; // stable across retries

  try {
    const res = await fetch("/api/service/create-so", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealId: String(soSelectedDeal.id),
        dealName: soSelectedDeal.name,
        dealAddress: [soSelectedDeal.address, soSelectedDeal.city, soSelectedDeal.state, soSelectedDeal.postalCode]
          .filter(Boolean).join(", "),
        requestToken,
        items: soLineItems.map(li => ({ productId: li.productId, quantity: li.quantity })),
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create SO");

    setSoResult({
      zohoSoId: data.zohoSoId,
      zohoSoNumber: data.zohoSoNumber,
      totalAmount: data.totalAmount,
      alreadyExisted: data.alreadyExisted,
    });
  } catch (err) {
    setSoError(err instanceof Error ? err.message : "Failed to create SO");
  } finally {
    setSoSubmitting(false);
  }
}, [soSelectedDeal, soLineItems]);
```

- [ ] **Step 7: Type-check and build**

Run: `npx tsc --noEmit 2>&1 | grep "service/page"`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboards/service/page.tsx
git commit -m "feat: add SO creation slide-over to service pipeline"
```

---

## Chunk 5: Wiring + Verification

### Task 9: Wire permissions + suite landing page

**Files:**
- Modify: `src/lib/role-permissions.ts`
- Modify: `src/app/suites/service/page.tsx`

- [ ] **Step 1: Add service-catalog route to role permissions**

In `src/lib/role-permissions.ts`, add `/dashboards/service-catalog` to the `allowedRoutes` array for each of these roles. Add it next to their existing `/dashboards/service-tickets` entry (all five have this route):

- MANAGER: add `/dashboards/service-catalog`
- OPERATIONS: add `/dashboards/service-catalog`
- OPERATIONS_MANAGER: add `/dashboards/service-catalog`
- PROJECT_MANAGER: add `/dashboards/service-catalog`
- TECH_OPS: add `/dashboards/service-catalog` (note: TECH_OPS does NOT have `/dashboards/service-overview`, but it does have `/dashboards/service-tickets` — add next to that)

ADMIN and OWNER have wildcard access and do not need explicit route entries.

- [ ] **Step 2: Add Service Catalog card to suite landing page**

In `src/app/suites/service/page.tsx`, add to the `LINKS` array:

```typescript
{
  href: "/dashboards/service-catalog",
  title: "Service Catalog",
  description: "Browse service products, pricing, and availability.",
  tag: "CATALOG",
  section: "Service",
},
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep "role-permissions\|suites/service"`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/role-permissions.ts src/app/suites/service/page.tsx
git commit -m "feat: wire service catalog permissions and suite landing card"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests pass (new + existing). Note pre-existing failures in unrelated files are acceptable.

- [ ] **Step 2: Type-check entire project**

Run: `npx tsc --noEmit`
Expected: No errors in new/modified files.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Compiled successfully.

- [ ] **Step 4: Verify migration**

Run: `npx prisma migrate status`
Expected: All migrations applied.

- [ ] **Step 5: Final commit (if any linting/type fixes needed)**

```bash
git add -A
git commit -m "fix: address lint/type issues from final verification"
```
