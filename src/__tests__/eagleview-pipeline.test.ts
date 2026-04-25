/**
 * Tests for the EagleView pipeline orchestrator + dedup helpers.
 *
 * Uses dependency injection (PipelineDeps) — no real EV/HubSpot/Drive calls.
 */
import {
  orderTrueDesign,
  fetchAndStoreDeliverables,
  type PipelineDeps,
  type DealAddressFields,
} from "@/lib/eagleview-pipeline";
import { claimOrder, findExistingOrder } from "@/lib/eagleview-dedup";
import type { EagleViewOrder } from "@/generated/prisma/client";
import type { EagleViewProduct } from "@/generated/prisma/enums";
import type { AddressParts } from "@/lib/address-hash";

// ---- in-memory prisma double ----

interface FakeRow extends Omit<EagleViewOrder, "id" | "orderedAt" | "createdAt" | "updatedAt"> {
  id: string;
  orderedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function makeFakePrisma() {
  const rows: FakeRow[] = [];
  let nextId = 1;
  return {
    rows,
    eagleViewOrder: {
      findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
        const w = args.where;
        if (typeof w.id === "string") {
          return rows.find((r) => r.id === w.id) ?? null;
        }
        if (typeof w.reportId === "string") {
          return rows.find((r) => r.reportId === w.reportId) ?? null;
        }
        const compound = w.dealId_productCode_addressHash as
          | { dealId: string; productCode: string; addressHash: string }
          | undefined;
        if (compound) {
          return (
            rows.find(
              (r) =>
                r.dealId === compound.dealId &&
                r.productCode === compound.productCode &&
                r.addressHash === compound.addressHash,
            ) ?? null
          );
        }
        return null;
      }),
      findFirst: jest.fn(async () => rows[0] ?? null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        // Enforce uniqueness on (dealId, productCode, addressHash)
        const dup = rows.find(
          (r) =>
            r.dealId === args.data.dealId &&
            r.productCode === args.data.productCode &&
            r.addressHash === args.data.addressHash,
        );
        if (dup) {
          const e = new Error("Unique constraint failed") as Error & { code?: string };
          e.code = "P2002";
          throw e;
        }
        const id = `o${nextId++}`;
        const now = new Date();
        const row: FakeRow = {
          id,
          dealId: String(args.data.dealId),
          productCode: args.data.productCode as EagleViewProduct,
          addressHash: String(args.data.addressHash),
          reportId: String(args.data.reportId),
          status: (args.data.status as FakeRow["status"]) ?? "ORDERED",
          triggeredBy: String(args.data.triggeredBy),
          surveyDate: (args.data.surveyDate as Date | null) ?? null,
          orderedAt: now,
          deliveredAt: null,
          errorMessage: null,
          estimatedDeliveryAt: null,
          driveFolderId: null,
          imageDriveFileId: null,
          layoutJsonDriveFileId: null,
          shadeJsonDriveFileId: null,
          reportPdfDriveFileId: null,
          reportXmlDriveFileId: null,
          cost: null,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = rows.findIndex((r) => r.id === args.where.id);
        if (idx === -1) throw new Error("not found");
        rows[idx] = { ...rows[idx], ...args.data, updatedAt: new Date() } as FakeRow;
        return rows[idx];
      }),
    },
  };
}

const mkAddress = (): AddressParts => ({
  street: "123 Main St",
  unit: null,
  city: "Denver",
  state: "CO",
  zip: "80202",
});

const mkDealAddress = (over: Partial<DealAddressFields> = {}): DealAddressFields => ({
  address: "123 Main St",
  address2: null,
  city: "Denver",
  state: "CO",
  zip: "80202",
  latitude: 39.7392,
  longitude: -104.9903,
  driveDesignDocumentsFolderId: "folder_design_001",
  driveAllDocumentsFolderId: "folder_all_001",
  ...over,
});

function mkDeps(prismaDouble: ReturnType<typeof makeFakePrisma>): PipelineDeps & {
  spies: {
    placeOrder: jest.Mock;
    checkSolarAvailability: jest.Mock;
    getFileLinks: jest.Mock;
    downloadFile: jest.Mock;
    getReport: jest.Mock;
    fetchDealAddress: jest.Mock;
    geocode: jest.Mock;
    ensureDriveFolder: jest.Mock;
    uploadToDrive: jest.Mock;
    postDealNote: jest.Mock;
  };
} {
  const placeOrder = jest.fn(async () => ({ reportId: 12345 }));
  const checkSolarAvailability = jest.fn(async () => ({
    jobId: "j1",
    address: "x",
    latitude: "39",
    longitude: "-105",
    availabilityStatus: [{ isAvailable: true, productId: 91 }],
    jobStatus: "Completed",
    requestId: "r1",
  }));
  const getFileLinks = jest.fn(async () => ({
    links: [
      { link: "https://signed.example.com/img", expireTimestamp: "", fileType: "image" },
      { link: "https://signed.example.com/pdf", expireTimestamp: "", fileType: "report-pdf" },
    ],
  }));
  const downloadFile = jest.fn(
    async () => new TextEncoder().encode("fake-bytes").buffer as ArrayBuffer,
  );
  const getReport = jest.fn(async () => ({ reportId: 12345, displayStatus: "Completed" }));
  const fetchDealAddress = jest.fn(async () => mkDealAddress());
  const geocode = jest.fn(async () => ({ latitude: 39.0, longitude: -105.0 }));
  const ensureDriveFolder = jest.fn(async () => "drive_folder_123");
  const uploadToDrive = jest.fn(async (_: string, name: string) => ({ id: `f_${name}`, name }));
  const postDealNote = jest.fn(async () => undefined);

  return {
    prisma: prismaDouble as unknown as PipelineDeps["prisma"],
    client: { placeOrder, checkSolarAvailability, getFileLinks, downloadFile, getReport },
    fetchDealAddress,
    geocode,
    ensureDriveFolder,
    uploadToDrive,
    postDealNote,
    spies: {
      placeOrder,
      checkSolarAvailability,
      getFileLinks,
      downloadFile,
      getReport,
      fetchDealAddress,
      geocode,
      ensureDriveFolder,
      uploadToDrive,
      postDealNote,
    },
  };
}

// ============================================================
// claimOrder
// ============================================================

describe("claimOrder", () => {
  it("inserts a new ORDERED row and reports isNew=true", async () => {
    const p = makeFakePrisma();
    const r = await claimOrder(p as unknown as PipelineDeps["prisma"], {
      dealId: "d1",
      productCode: "TDP",
      address: mkAddress(),
      triggeredBy: "test",
    });
    expect(r.isNew).toBe(true);
    expect(r.order.status).toBe("ORDERED");
    expect(r.order.dealId).toBe("d1");
    expect(p.rows.length).toBe(1);
  });

  it("returns existing row + isNew=false on duplicate claim", async () => {
    const p = makeFakePrisma();
    const first = await claimOrder(p as unknown as PipelineDeps["prisma"], {
      dealId: "d1",
      productCode: "TDP",
      address: mkAddress(),
      triggeredBy: "test",
    });
    const second = await claimOrder(p as unknown as PipelineDeps["prisma"], {
      dealId: "d1",
      productCode: "TDP",
      address: mkAddress(),
      triggeredBy: "test-other",
    });
    expect(second.isNew).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect(p.rows.length).toBe(1);
  });

  it("findExistingOrder returns the row when present, null when absent", async () => {
    const p = makeFakePrisma();
    expect(
      await findExistingOrder(
        p as unknown as PipelineDeps["prisma"],
        "d1",
        "TDP" as EagleViewProduct,
        mkAddress(),
      ),
    ).toBeNull();
    await claimOrder(p as unknown as PipelineDeps["prisma"], {
      dealId: "d1",
      productCode: "TDP",
      address: mkAddress(),
      triggeredBy: "test",
    });
    const found = await findExistingOrder(
      p as unknown as PipelineDeps["prisma"],
      "d1",
      "TDP" as EagleViewProduct,
      mkAddress(),
    );
    expect(found).not.toBeNull();
    expect(found?.dealId).toBe("d1");
  });
});

// ============================================================
// orderTrueDesign — happy path + failures
// ============================================================

describe("orderTrueDesign", () => {
  it("places order and returns ORDERED on happy path", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    const r = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(r.status).toBe("ORDERED");
    expect(r.isNew).toBe(true);
    expect(r.reportId).toBe("12345");
    expect(deps.spies.checkSolarAvailability).toHaveBeenCalledTimes(1);
    expect(deps.spies.placeOrder).toHaveBeenCalledTimes(1);
    expect(deps.spies.postDealNote).toHaveBeenCalledTimes(1);
  });

  it("uses HubSpot lat/lng without geocoding if present", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.geocode).not.toHaveBeenCalled();
  });

  it("geocodes when HubSpot lacks coordinates", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.fetchDealAddress.mockResolvedValueOnce(
      mkDealAddress({ latitude: null, longitude: null }),
    );
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.geocode).toHaveBeenCalledTimes(1);
    expect(deps.spies.placeOrder).toHaveBeenCalledTimes(1);
  });

  it("returns FAILED with reason=address_incomplete when deal lacks address", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.fetchDealAddress.mockResolvedValueOnce(
      mkDealAddress({ address: "", city: "", zip: "" }),
    );
    const r = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("address_incomplete");
    expect(deps.spies.placeOrder).not.toHaveBeenCalled();
  });

  it("returns FAILED + marks row when availability says unavailable", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.checkSolarAvailability.mockResolvedValueOnce({
      jobId: "j",
      address: "x",
      latitude: "0",
      longitude: "0",
      availabilityStatus: [{ isAvailable: false, productId: 91 }],
      jobStatus: "Completed",
      requestId: "r",
    });
    const r = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("tdp_unavailable_at_address");
    expect(deps.spies.placeOrder).not.toHaveBeenCalled();
    // Row exists in FAILED state for audit
    expect(p.rows[0].status).toBe("FAILED");
    expect(p.rows[0].errorMessage).toBe("tdp_unavailable_at_address");
  });

  it("returns FAILED when EagleView placeOrder throws", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.placeOrder.mockRejectedValueOnce(new Error("HTTP 500"));
    const r = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("place_order_failed");
    expect(p.rows[0].status).toBe("FAILED");
  });

  it("idempotently returns existing row on duplicate claim", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    const first = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    const second = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test-2" });
    expect(second.isNew).toBe(false);
    expect(second.orderId).toBe(first.orderId);
    expect(deps.spies.placeOrder).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// fetchAndStoreDeliverables
// ============================================================

describe("fetchAndStoreDeliverables", () => {
  it("downloads + uploads files and marks DELIVERED", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    // First place an order so we have a row
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });

    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.downloadFile).toHaveBeenCalledTimes(2);
    expect(deps.spies.uploadToDrive).toHaveBeenCalledTimes(2);

    const row = p.rows[0];
    expect(row.status).toBe("DELIVERED");
    expect(row.driveFolderId).toBe("drive_folder_123");
    expect(row.imageDriveFileId).toContain("image");
    expect(row.reportPdfDriveFileId).toContain("report-pdf");
    expect(row.deliveredAt).toBeInstanceOf(Date);
  });

  it("skips when already DELIVERED", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    p.rows[0].status = "DELIVERED";
    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("SKIPPED");
    expect(deps.spies.downloadFile).not.toHaveBeenCalled();
  });

  it("returns FAILED when no files yet", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.getFileLinks.mockResolvedValueOnce({ links: [] });
    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("no_files_yet");
  });

  it("returns FAILED when no Drive folder available", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.fetchDealAddress.mockResolvedValueOnce(
      mkDealAddress({
        driveDesignDocumentsFolderId: null,
        driveAllDocumentsFolderId: null,
      }),
    );
    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("drive_folder_missing");
  });

  it("returns FAILED if order not found", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    const r = await fetchAndStoreDeliverables(deps, "doesnt_exist");
    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("order_not_found");
  });
});
