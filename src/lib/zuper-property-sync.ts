/**
 * src/lib/zuper-property-sync.ts
 *
 * Syncs HubSpotPropertyCache data → Zuper Property module.
 * Creates/updates Zuper Property objects and links jobs.
 */

import { prisma } from "@/lib/db";
import { mergeZuperMetaData, type ZuperMetaDataEntry } from "@/lib/zuper-catalog";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ZUPER_API_URL = process.env.ZUPER_API_URL || "https://us-west-1c.zuperpro.com/api";
const INTER_OP_DELAY_MS = 200;

export const ZUPER_PROPERTY_FIELD_LABELS = [
  "System Size (kW)",
  "Has Battery",
  "Has EV Charger",
  "Install Date",
  "Year Built",
  "Square Footage",
  "Stories",
  "PB Location",
  "AHJ",
  "Utility",
  // NEW — Tesla PowerHub cross-link
  "Tesla PowerHub",
  "Tesla Site ID",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PropertyFieldSource {
  systemSizeKwDc: number | null;
  hasBattery: boolean;
  hasEvCharger: boolean;
  firstInstallDate: Date | null;
  yearBuilt: number | null;
  squareFootage: number | null;
  stories: number | null;
  pbLocation: string | null;
  ahjName: string | null;
  utilityName: string | null;
  // NEW
  teslaPortalUrl: string | null;
  teslaSiteId: string | null;
}

export interface SyncPropertyResult {
  propertyId: string;
  zuperPropertyUid: string;
  action: "created" | "updated" | "skipped";
  jobsLinked: number;
  projectsLinked: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Field Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the 10 Zuper custom field entries from a HubSpotPropertyCache record.
 * All values are stringified per Zuper's meta_data format.
 */
export function buildPropertyCustomFields(property: PropertyFieldSource): ZuperMetaDataEntry[] {
  const str = (v: unknown): string => (v != null && v !== "" ? String(v) : "");
  const dateStr = (d: Date | null): string => {
    if (!d) return "";
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  };

  return [
    { label: "System Size (kW)", value: property.systemSizeKwDc != null ? String(property.systemSizeKwDc) : "N/A", type: "SINGLE_LINE" },
    { label: "Has Battery", value: property.hasBattery ? "Yes" : "No", type: "SINGLE_LINE" },
    { label: "Has EV Charger", value: property.hasEvCharger ? "Yes" : "No", type: "SINGLE_LINE" },
    { label: "Install Date", value: dateStr(property.firstInstallDate), type: "SINGLE_LINE" },
    { label: "Year Built", value: str(property.yearBuilt), type: "SINGLE_LINE" },
    { label: "Square Footage", value: str(property.squareFootage), type: "SINGLE_LINE" },
    { label: "Stories", value: str(property.stories), type: "SINGLE_LINE" },
    { label: "PB Location", value: str(property.pbLocation), type: "SINGLE_LINE" },
    { label: "AHJ", value: str(property.ahjName), type: "SINGLE_LINE" },
    { label: "Utility", value: str(property.utilityName), type: "SINGLE_LINE" },
    { label: "Tesla PowerHub", value: str(property.teslaPortalUrl), type: "SINGLE_LINE" },
    { label: "Tesla Site ID", value: str(property.teslaSiteId), type: "SINGLE_LINE" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Zuper API Helpers
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function zuperFetch(path: string, init?: RequestInit): Promise<Response> {
  const apiKey = process.env.ZUPER_API_KEY;
  if (!apiKey) throw new Error("ZUPER_API_KEY not set");

  const res = await fetch(`${ZUPER_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Zuper API ${init?.method ?? "GET"} ${path} failed: ${res.status} ${body.slice(0, 200)}`);
  }

  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Update Zuper Property
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new Zuper Property. Returns the created property UID.
 * Optionally associates the property with a Zuper customer.
 */
export async function createZuperProperty(
  address: { street: string; city: string; state: string; zip: string },
  customFields: ZuperMetaDataEntry[],
  customerUid?: string | null,
): Promise<string> {
  const propertyName = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const propertyPayload: Record<string, any> = {
    property_name: propertyName,
    property_address: {
      street: address.street,
      city: address.city,
      state: address.state,
      zip_code: address.zip,
      country: "US",
    },
    custom_fields: customFields,
  };

  // Zuper uses { customer: "<uid>" } format inside property_customers array
  if (customerUid) {
    propertyPayload.property_customers = [{ customer: customerUid }];
  }

  const res = await zuperFetch("/property", {
    method: "POST",
    body: JSON.stringify({ property: propertyPayload }),
  });

  const data = await res.json();
  const uid = data?.data?.property_uid ?? data?.data?.uid;
  if (!uid) throw new Error(`Zuper create property returned no UID: ${JSON.stringify(data).slice(0, 200)}`);
  return uid;
}

/**
 * Update an existing Zuper Property's custom fields using read-merge-write.
 * This preserves any fields we don't manage (e.g. manually added by techs).
 * Optionally associates the property with a Zuper customer if not already linked.
 */
export async function updateZuperProperty(
  zuperPropertyUid: string,
  newFields: ZuperMetaDataEntry[],
  customerUid?: string | null,
): Promise<void> {
  // 1. Read existing fields
  const readRes = await zuperFetch(`/property/${zuperPropertyUid}`);
  const readData = await readRes.json();
  const existingProperty = readData?.data ?? {};
  const existingFields = existingProperty.custom_fields ?? existingProperty.property?.custom_fields ?? [];

  // 2. Merge (preserves fields we don't own, updates ours)
  const merged = mergeZuperMetaData(existingFields, newFields);

  // 3. Build update payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updatePayload: Record<string, any> = { custom_fields: merged };

  // Add customer if provided and not already associated
  if (customerUid) {
    const existingCustomers: Array<{ customer_uid?: string }> = existingProperty.property_customers ?? [];
    const alreadyLinked = existingCustomers.some((c) => c.customer_uid === customerUid);
    if (!alreadyLinked) {
      updatePayload.property_customers = [
        ...existingCustomers.filter((c) => c.customer_uid).map((c) => ({ customer: c.customer_uid })),
        { customer: customerUid },
      ];
    }
  }

  // 4. Write back
  await zuperFetch(`/property/${zuperPropertyUid}`, {
    method: "PUT",
    body: JSON.stringify({ property: updatePayload }),
  });
}

/**
 * Link a Zuper job to a Zuper Property by setting the property field on the job.
 */
export async function linkJobToProperty(jobUid: string, zuperPropertyUid: string): Promise<void> {
  await zuperFetch("/jobs", {
    method: "PUT",
    body: JSON.stringify({
      job: {
        job_uid: jobUid,
        property: zuperPropertyUid,
      },
    }),
  });
}

/**
 * Link a Zuper project to a Zuper Property.
 * Uses the `properties` array field: [{ property: "<uid>" }].
 * Reads existing properties first to avoid overwriting other links.
 */
export async function linkProjectToProperty(projectUid: string, zuperPropertyUid: string): Promise<void> {
  // Read existing project to check current properties
  const readRes = await zuperFetch(`/projects/${projectUid}`);
  const readData = await readRes.json();
  const existingProperties: Array<{ property?: { property_uid?: string } }> =
    readData?.data?.properties ?? [];

  // Skip if already linked
  const alreadyLinked = existingProperties.some(
    (p) => p.property?.property_uid === zuperPropertyUid
  );
  if (alreadyLinked) return;

  // Build new properties array preserving existing links
  const updatedProperties = [
    ...existingProperties.map((p) => ({ property: p.property?.property_uid })),
    { property: zuperPropertyUid },
  ];

  await zuperFetch(`/projects/${projectUid}`, {
    method: "PUT",
    body: JSON.stringify({ project: { properties: updatedProperties } }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Orchestration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync a single property to Zuper: create or update the Zuper Property,
 * then link any unlinked jobs. Returns the result.
 */
export async function syncPropertyToZuper(propertyCacheId: string): Promise<SyncPropertyResult> {
  const property = await prisma.hubSpotPropertyCache.findUniqueOrThrow({
    where: { id: propertyCacheId },
    include: { dealLinks: true },
  });

  const fields = buildPropertyCustomFields({
    systemSizeKwDc: property.systemSizeKwDc,
    hasBattery: property.hasBattery,
    hasEvCharger: property.hasEvCharger,
    firstInstallDate: property.firstInstallDate,
    yearBuilt: property.yearBuilt,
    squareFootage: property.squareFootage,
    stories: property.stories,
    pbLocation: property.pbLocation,
    ahjName: property.ahjName,
    utilityName: property.utilityName,
    teslaPortalUrl: property.teslaPortalUrl,
    teslaSiteId: property.teslaSiteId,
  });

  // Resolve customer UID from linked jobs.
  // Only associate if ALL jobs agree on the same customer (avoids misassociation
  // when a property changed owners or has duplicate Zuper customers).
  let customerUid: string | null = null;
  const dealIds = property.dealLinks.map((l) => l.dealId);
  if (dealIds.length > 0) {
    const jobsWithCustomer = await prisma.zuperJobCache.findMany({
      where: { hubspotDealId: { in: dealIds } },
      select: { rawData: true },
    });
    const customerUids = new Set<string>();
    for (const j of jobsWithCustomer) {
      const raw = j.rawData as Record<string, unknown> | null;
      const customer = raw?.customer as Record<string, unknown> | undefined;
      const uid = customer?.customer_uid as string | undefined;
      if (uid) customerUids.add(uid);
    }
    // Only associate if unanimous (1 unique customer across all jobs)
    if (customerUids.size === 1) {
      customerUid = [...customerUids][0];
    } else if (customerUids.size > 1) {
      console.warn(
        `[zuper-property-sync] Skipping customer association for property ${propertyCacheId}: ` +
        `${customerUids.size} different customers found across ${jobsWithCustomer.length} jobs`
      );
    }
  }

  let zuperPropertyUid = property.zuperPropertyUid;
  let action: "created" | "updated" | "skipped";

  if (!zuperPropertyUid) {
    // Create new Zuper Property
    zuperPropertyUid = await createZuperProperty(
      {
        street: property.streetAddress,
        city: property.city,
        state: property.state,
        zip: property.zip,
      },
      fields,
      customerUid,
    );
    action = "created";
  } else {
    // Update existing
    await updateZuperProperty(zuperPropertyUid, fields, customerUid);
    action = "updated";
  }

  // Update cache with UID + sync timestamp + reset fail count
  await prisma.hubSpotPropertyCache.update({
    where: { id: propertyCacheId },
    data: {
      zuperPropertyUid,
      zuperPropertySyncedAt: new Date(),
      zuperSyncFailCount: 0,
    },
  });

  // Link unlinked jobs (cap at 10 per sync to stay within time budget)
  // Safety: verify job address matches property before linking to prevent
  // stale PropertyDealLink entries from cascading into wrong associations.
  let jobsLinked = 0;
  let projectsLinked = 0;
  const propStreetNum = (property.streetAddress || "").match(/^(\d+)/)?.[1];
  const linkedProjectUids = new Set<string>();

  if (dealIds.length > 0) {
    const zuperJobs = await prisma.zuperJobCache.findMany({
      where: { hubspotDealId: { in: dealIds } },
      select: { jobUid: true, rawData: true },
      take: 10,
    });

    for (const job of zuperJobs) {
      const raw = job.rawData as Record<string, unknown> | null;

      // Collect project UIDs from jobs for project linking below
      const project = raw?.project as Record<string, unknown> | undefined;
      const projUid = project?.project_uid as string | undefined;
      if (projUid) linkedProjectUids.add(projUid);

      // Check if job already has a property linked
      const existingProp = raw?.property ?? raw?.property_uid;
      if (existingProp) continue;

      // Address sanity check: job's customer address street number should match property
      if (propStreetNum) {
        const custAddr = (raw?.customer as Record<string, unknown>)?.customer_address as Record<string, string> | undefined;
        const jobStreet = custAddr?.street || "";
        const jobStreetNum = jobStreet.match(/^(\d+)/)?.[1];
        if (jobStreetNum && jobStreetNum !== propStreetNum) {
          console.warn(
            `[zuper-property-sync] Skipping job ${job.jobUid} link: address mismatch ` +
            `(job: "${jobStreet}" vs property: "${property.streetAddress}")`
          );
          continue;
        }
      }

      try {
        await linkJobToProperty(job.jobUid, zuperPropertyUid);
        jobsLinked++;
        await sleep(INTER_OP_DELAY_MS);
      } catch (err) {
        console.warn(`[zuper-property-sync] Failed to link job ${job.jobUid}:`, err);
      }
    }
  }

  // Link related Zuper projects to the property (deduped, cap at 5)
  for (const projUid of [...linkedProjectUids].slice(0, 5)) {
    try {
      await linkProjectToProperty(projUid, zuperPropertyUid);
      projectsLinked++;
      await sleep(INTER_OP_DELAY_MS);
    } catch (err) {
      console.warn(`[zuper-property-sync] Failed to link project ${projUid}:`, err);
    }
  }

  return { propertyId: propertyCacheId, zuperPropertyUid, action, jobsLinked, projectsLinked };
}

/**
 * Find properties that need syncing to Zuper.
 * A property is dirty when:
 *   - zuperPropertyUid is null (never synced), OR
 *   - updatedAt > zuperPropertySyncedAt (data changed since last sync)
 * Requires at least one deal OR ticket link (service-only properties need Zuper visibility too).
 * Excludes poison rows (zuperSyncFailCount >= 5).
 */
export async function findDirtyProperties(limit: number): Promise<Array<{ id: string }>> {
  return prisma.$queryRaw<Array<{ id: string }>>`
    SELECT pc.id
    FROM "HubSpotPropertyCache" pc
    WHERE pc."zuperSyncFailCount" < 5
      AND (
        EXISTS (SELECT 1 FROM "PropertyDealLink" pdl WHERE pdl."propertyId" = pc.id)
        OR EXISTS (SELECT 1 FROM "PropertyTicketLink" ptl WHERE ptl."propertyId" = pc.id)
      )
      AND (
        pc."zuperPropertyUid" IS NULL
        OR pc."zuperPropertySyncedAt" IS NULL
        OR pc."updatedAt" > pc."zuperPropertySyncedAt"
      )
    ORDER BY pc."updatedAt" ASC
    LIMIT ${limit}
  `;
}
