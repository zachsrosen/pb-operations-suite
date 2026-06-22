/**
 * Tests for the EagleView pipeline orchestrator + dedup helpers.
 *
 * Uses dependency injection (PipelineDeps) — no real EV/HubSpot/Drive calls.
 */
import {
  orderTrueDesign,
  fetchAndStoreDeliverables,
  buildEagleViewProps,
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
          ticketId: (args.data.ticketId as string | null) ?? null,
          productCode: args.data.productCode as EagleViewProduct,
          addressHash: String(args.data.addressHash),
          reportId: String(args.data.reportId),
          status: (args.data.status as FakeRow["status"]) ?? "ORDERED",
          triggeredBy: String(args.data.triggeredBy),
          surveyDate: (args.data.surveyDate as Date | null) ?? null,
          orderedAt: now,
          deliveredAt: null,
          errorMessage: null,
          failedAttempts: 0,
          estimatedDeliveryAt: null,
          driveFolderId: null,
          imageDriveFileId: null,
          layoutJsonDriveFileId: null,
          shadeJsonDriveFileId: null,
          reportPdfDriveFileId: null,
          reportXmlDriveFileId: null,
          designVersionId: null,
          dxfDriveFileId: null,
          dwgDriveFileId: null,
          designPdfDriveFileId: null,
          designFilesPulledAt: null,
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
        // Resolve Prisma atomic operators (e.g. { increment: n }) the way the real client would.
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args.data)) {
          if (
            value &&
            typeof value === "object" &&
            "increment" in (value as Record<string, unknown>)
          ) {
            const current = (rows[idx] as unknown as Record<string, unknown>)[key];
            resolved[key] =
              (typeof current === "number" ? current : 0) +
              ((value as { increment: number }).increment ?? 0);
          } else {
            resolved[key] = value;
          }
        }
        rows[idx] = { ...rows[idx], ...resolved, updatedAt: new Date() } as FakeRow;
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
    listDriveFiles: jest.Mock;
    postDealNote: jest.Mock;
    stampStatus: jest.Mock;
  };
} {
  const placeOrder = jest.fn(async () => ({ reportIds: [12345], orderId: 99 }));
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
  const listDriveFiles = jest.fn(async () => [] as { id: string; name: string }[]);
  const postDealNote = jest.fn(async () => undefined);
  const stampStatus = jest.fn(async () => undefined);

  return {
    prisma: prismaDouble as unknown as PipelineDeps["prisma"],
    client: { placeOrder, checkSolarAvailability, getFileLinks, downloadFile, getReport },
    fetchDealAddress,
    geocode,
    ensureDriveFolder,
    uploadToDrive,
    listDriveFiles,
    postDealNote,
    stampStatus,
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
      listDriveFiles,
      postDealNote,
      stampStatus,
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

  it("geocodes the address (authoritative) even when stored coords are present", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    // The verified address drives the order, not a possibly-stale stored lat/lng (FS #821).
    expect(deps.spies.geocode).toHaveBeenCalledTimes(1);
    // Order uses geocoded coords (39.0, -105.0), NOT the stored ones (39.7392, -104.9903).
    expect(deps.spies.checkSolarAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 39.0, longitude: -105.0 }),
      expect.anything(),
    );
  });

  it("falls back to stored coords when geocoding fails", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.geocode.mockResolvedValueOnce(null);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.checkSolarAvailability).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: 39.7392, longitude: -104.9903 }),
      expect.anything(),
    );
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

  it("persists ticketId on the order row when provided", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", ticketId: "t99", triggeredBy: "test" });
    expect(p.rows[0].ticketId).toBe("t99");
  });
});

describe("orderTrueDesign — HubSpot stamping", () => {
  it("stamps Ordered with report id + ordered date on the deal", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.stampStatus).toHaveBeenCalledWith(
      { dealId: "d1", ticketId: null },
      expect.objectContaining({ status: "Ordered", reportId: "12345" }),
    );
    const fields = deps.spies.stampStatus.mock.calls[0][1];
    expect(fields.orderedDate).toBeInstanceOf(Date);
  });

  it("stamps Failed when placeOrder throws", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.placeOrder.mockRejectedValueOnce(new Error("HTTP 500"));
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(deps.spies.stampStatus).toHaveBeenCalledWith(
      { dealId: "d1", ticketId: null },
      { status: "Failed" },
    );
  });

  it("targets the ticket when the order originated from a ticket", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", ticketId: "t7", triggeredBy: "test" });
    expect(deps.spies.stampStatus).toHaveBeenCalledWith(
      { dealId: "d1", ticketId: "t7" },
      expect.objectContaining({ status: "Ordered" }),
    );
  });

  it("does not fail the order if stampStatus throws (best-effort)", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    deps.spies.stampStatus.mockRejectedValue(new Error("hubspot down"));
    const r = await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    expect(r.status).toBe("ORDERED");
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

  it("saves the shade analysis as a .zip (not .json)", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    // EagleView's shade deliverable is a ZIP bundle, fileType "Shading".
    deps.spies.getFileLinks.mockResolvedValueOnce({
      links: [{ link: "https://signed.example.com/shade", expireTimestamp: "", fileType: "Shading" }],
    });
    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.uploadToDrive).toHaveBeenCalledWith(
      "drive_folder_123",
      "Shading.zip",
      expect.anything(),
      "application/zip",
    );
    expect(p.rows[0].shadeJsonDriveFileId).toBe("f_Shading.zip");
  });

  it("backfills missing files on a DELIVERED order without re-stamping", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    // Simulate a prior partial delivery: DELIVERED, folder set, but no files yet.
    const firstDelivered = new Date("2026-06-22T20:00:00Z");
    p.rows[0].status = "DELIVERED";
    p.rows[0].driveFolderId = "drive_folder_123";
    p.rows[0].deliveredAt = firstDelivered;
    deps.spies.stampStatus.mockClear();

    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("DELIVERED");
    // Default getFileLinks returns image + report-pdf — both newly pulled.
    expect(deps.spies.downloadFile).toHaveBeenCalledTimes(2);
    expect(p.rows[0].imageDriveFileId).toContain("image");
    expect(p.rows[0].reportPdfDriveFileId).toContain("report-pdf");
    // Backfill must NOT re-stamp HubSpot, and must preserve the original date.
    expect(deps.spies.stampStatus).not.toHaveBeenCalled();
    expect(p.rows[0].deliveredAt).toEqual(firstDelivered);
    // Reused the existing folder rather than creating a new one.
    expect(deps.spies.ensureDriveFolder).not.toHaveBeenCalled();
  });

  it("backfill skips files already stored (by column) and only pulls the missing one", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    p.rows[0].status = "DELIVERED";
    p.rows[0].driveFolderId = "drive_folder_123";
    p.rows[0].deliveredAt = new Date();
    p.rows[0].imageDriveFileId = "already_have_image"; // image present, pdf missing

    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("DELIVERED");
    expect(deps.spies.downloadFile).toHaveBeenCalledTimes(1); // only the pdf
    expect(p.rows[0].imageDriveFileId).toBe("already_have_image"); // preserved
    expect(p.rows[0].reportPdfDriveFileId).toContain("report-pdf");
  });

  it("backfill skips files already in the folder (by filename)", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    p.rows[0].status = "DELIVERED";
    p.rows[0].driveFolderId = "drive_folder_123";
    p.rows[0].deliveredAt = new Date();
    // Folder already has both files (e.g. metadata-style dedup) — nothing new.
    deps.spies.listDriveFiles.mockResolvedValueOnce([
      { id: "x", name: "image.jpg" },
      { id: "y", name: "report-pdf.pdf" },
    ]);

    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("SKIPPED");
    expect(r.reason).toBe("no_new_files");
    expect(deps.spies.downloadFile).not.toHaveBeenCalled();
  });

  it("backfill returns no_new_files without recording a failure when nothing is new", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    p.rows[0].status = "DELIVERED";
    p.rows[0].driveFolderId = "drive_folder_123";
    p.rows[0].deliveredAt = new Date();
    p.rows[0].imageDriveFileId = "have_image";
    p.rows[0].reportPdfDriveFileId = "have_pdf"; // both default links already stored

    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("SKIPPED");
    expect(r.reason).toBe("no_new_files");
    expect(p.rows[0].failedAttempts).toBe(0); // no failure recorded
    expect(p.rows[0].status).toBe("DELIVERED");
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

// ============================================================
// fetchAndStoreDeliverables — failures must be persisted, not swallowed
// (regression: 38 orders silently stranded in ORDERED with errorMessage=null)
// ============================================================

describe("fetchAndStoreDeliverables — failure persistence", () => {
  it("records errorMessage + increments failedAttempts but keeps status ORDERED when no files yet", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.getFileLinks.mockResolvedValueOnce({ links: [] });

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("no_files_yet");
    // Row must stay ORDERED (retryable) but the failure must be visible in the DB.
    expect(p.rows[0].status).toBe("ORDERED");
    expect(p.rows[0].errorMessage).toBe("no_files_yet");
    expect(p.rows[0].failedAttempts).toBe(1);
  });

  it("persists errorMessage on drive_folder_missing while staying ORDERED", async () => {
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
    expect(p.rows[0].status).toBe("ORDERED");
    expect(p.rows[0].errorMessage).toBe("drive_folder_missing");
    expect(p.rows[0].failedAttempts).toBe(1);
  });

  it("persists errorMessage on get_file_links_failed while staying ORDERED", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.getFileLinks.mockRejectedValueOnce(new Error("boom"));

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("get_file_links_failed");
    expect(p.rows[0].status).toBe("ORDERED");
    expect(p.rows[0].errorMessage).toBe("get_file_links_failed");
    expect(p.rows[0].failedAttempts).toBe(1);
  });

  it("persists errorMessage on all_uploads_failed while staying ORDERED", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.downloadFile.mockRejectedValue(new Error("download boom"));

    const r = await fetchAndStoreDeliverables(deps, "12345");

    expect(r.status).toBe("FAILED");
    expect(r.reason).toBe("all_uploads_failed");
    expect(p.rows[0].status).toBe("ORDERED");
    expect(p.rows[0].errorMessage).toBe("all_uploads_failed");
    expect(p.rows[0].failedAttempts).toBe(1);
  });

  it("accumulates failedAttempts across repeated failures", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.getFileLinks.mockResolvedValue({ links: [] });

    await fetchAndStoreDeliverables(deps, "12345");
    await fetchAndStoreDeliverables(deps, "12345");

    expect(p.rows[0].status).toBe("ORDERED");
    expect(p.rows[0].failedAttempts).toBe(2);
  });
});

// ============================================================
// fetchAndStoreDeliverables — EagleView's real file-link types
// ============================================================

describe("fetchAndStoreDeliverables — EagleView file-link type mapping", () => {
  it("maps ExtendedOrthoImage/Shading/ExtendedOrthoImageMetadata to correct columns + extensions", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.getFileLinks.mockResolvedValueOnce({
      links: [
        { link: "https://signed.example.com/ortho", expireTimestamp: "", fileType: "ExtendedOrthoImage" },
        { link: "https://signed.example.com/meta", expireTimestamp: "", fileType: "ExtendedOrthoImageMetadata" },
        { link: "https://signed.example.com/shade", expireTimestamp: "", fileType: "Shading" },
      ],
    });

    const r = await fetchAndStoreDeliverables(deps, "12345");
    expect(r.status).toBe("DELIVERED");

    const row = p.rows[0];
    // ExtendedOrthoImage → image column, .jpg extension (NOT .bin)
    expect(row.imageDriveFileId).not.toBeNull();
    expect(row.imageDriveFileId).toContain("ExtendedOrthoImage.jpg");
    // Shading → shade column, .zip extension (the bundle is a ZIP, NOT JSON/.bin)
    expect(row.shadeJsonDriveFileId).not.toBeNull();
    expect(row.shadeJsonDriveFileId).toContain("Shading.zip");
    // Metadata must not be misfiled as an image (.jpg); it is JSON.
    const uploadedNames = deps.spies.uploadToDrive.mock.calls.map((c) => c[1]);
    expect(uploadedNames).toContain("ExtendedOrthoImageMetadata.json");
    expect(uploadedNames).not.toContain("Shading.json");
    expect(uploadedNames).not.toContain("Shading.bin");
  });
});

describe("fetchAndStoreDeliverables — HubSpot stamping", () => {
  it("stamps Delivered with report id, folder url, delivered date", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    await fetchAndStoreDeliverables(deps, "12345");
    const call = deps.spies.stampStatus.mock.calls.find((c) => c[1].status === "Delivered");
    expect(call).toBeDefined();
    expect(call![0]).toEqual({ dealId: "d1", ticketId: null });
    expect(call![1].reportId).toBe("12345");
    expect(call![1].driveFolderUrl).toContain("drive_folder_123");
    expect(call![1].deliveredDate).toBeInstanceOf(Date);
  });

  it("does NOT stamp on retryable failure (status stays ORDERED)", async () => {
    const p = makeFakePrisma();
    const deps = mkDeps(p);
    await orderTrueDesign(deps, { dealId: "d1", triggeredBy: "test" });
    deps.spies.stampStatus.mockClear();
    deps.spies.getFileLinks.mockResolvedValueOnce({ links: [] });
    await fetchAndStoreDeliverables(deps, "12345");
    expect(deps.spies.stampStatus).not.toHaveBeenCalled();
  });
});

// ============================================================
// buildEagleViewProps
// ============================================================

describe("buildEagleViewProps", () => {
  it("maps fields to HubSpot internal names and formats dates as UTC YYYY-MM-DD", () => {
    const props = buildEagleViewProps({
      status: "Delivered",
      reportId: "12345",
      driveFolderUrl: "https://drive.google.com/drive/folders/abc",
      orderedDate: new Date("2026-06-01T00:00:00Z"),
      deliveredDate: new Date("2026-06-18T23:30:00Z"),
    });
    expect(props).toEqual({
      eagleview_status: "Delivered",
      eagleview_report_id: "12345",
      eagleview_truedesign_url: "https://apps.eagleview.com/truedesign/12345",
      eagleview_order_url: "https://apps.eagleview.com/myev/orders/report/12345",
      eagleview_drive_folder_url: "https://drive.google.com/drive/folders/abc",
      eagleview_ordered_date: "2026-06-01",
      eagleview_delivered_date: "2026-06-18",
    });
  });

  it("derives truedesign + order URLs from reportId, and omits them for pending ids", () => {
    expect(buildEagleViewProps({ status: "Ordered", reportId: "99" })).toMatchObject({
      eagleview_truedesign_url: "https://apps.eagleview.com/truedesign/99",
      eagleview_order_url: "https://apps.eagleview.com/myev/orders/report/99",
    });
    const pending = buildEagleViewProps({ status: "Ordered", reportId: "pending:x" });
    expect(pending.eagleview_truedesign_url).toBeUndefined();
    expect(pending.eagleview_order_url).toBeUndefined();
  });

  it("omits absent/null keys", () => {
    expect(buildEagleViewProps({ status: "Failed" })).toEqual({
      eagleview_status: "Failed",
    });
  });

  it("formats a date near a UTC boundary without timezone drift", () => {
    // 2026-06-18T23:30:00Z must stay 2026-06-18 regardless of local TZ.
    const props = buildEagleViewProps({
      status: "Delivered",
      deliveredDate: new Date(Date.UTC(2026, 5, 18, 23, 30, 0)),
    });
    expect(props.eagleview_delivered_date).toBe("2026-06-18");
  });
});
