/**
 * Backfill EagleViewOrder rows from Gmail history.
 *
 * Searches every user mailbox in the Photon Brothers Workspace for
 * customerservice@eagleview.com order confirmation emails, parses the
 * structured subject lines, matches each order's address to a HubSpot
 * deal, and inserts EagleViewOrder rows with status=DELIVERED.
 *
 * Captures orders that didn't CC zach@photonbrothers.com — Sam Paro,
 * Drew Perry, Derek, Joe, Richard, Pat, Rolando, Kaitlyn, Peter Zaun,
 * Alexis, etc. all place orders independently.
 *
 * Run:
 *   npx tsx scripts/backfill-eagleview-from-gmail.ts
 *   npx tsx scripts/backfill-eagleview-from-gmail.ts --dry-run
 *   npx tsx scripts/backfill-eagleview-from-gmail.ts --user sam.paro@photonbrothers.com
 *
 * Env required:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY  (base64-encoded PEM)
 *   HUBSPOT_ACCESS_TOKEN
 *   DATABASE_URL
 */
import { createSign, createPrivateKey } from "crypto";
import { PrismaClient } from "../src/generated/prisma/client.js";

// ============================================================
// Config
// ============================================================

/** Mailboxes to search. Add new orderers here as the team grows. */
const MAILBOXES = [
  "zach.rosen@photonbrothers.com",
  "zach@photonbrothers.com",
  "sam.paro@photonbrothers.com",
  "drew@photonbrothers.com",
  "derek@photonbrothers.com",
  "joe@photonbrothers.com",
  "richard@photonbrothers.com",
  "pat@photonbrothers.com",
  "rolando@photonbrothers.com",
  "kaitlyn@photonbrothers.com",
  "peter.zaun@photonbrothers.com",
  "alexis@photonbrothers.com",
  "jacob.campbell@photonbrothers.com",
];

const GMAIL_QUERY =
  "from:customerservice@eagleview.com subject:(EagleView Report)";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const HUBSPOT_API = "https://api.hubapi.com";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const USER_FLAG = process.argv.indexOf("--user");
const SINGLE_USER = USER_FLAG > -1 ? process.argv[USER_FLAG + 1] : null;

// ============================================================
// Types
// ============================================================

interface ParsedOrder {
  reportId: string;
  rawAddress: string;
  productName: string;
  productCode: "TDP" | "TDS" | "IA" | "OTHER";
  cost: number;
  sqft: number;
  orderedAt: Date;
  sourceMailbox: string;
  sourceMessageId: string;
}

interface HubSpotDeal {
  id: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  surveyDate?: string;
}

// ============================================================
// Service-account JWT auth
// ============================================================

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getPrivateKeyPem(): string {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "";
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY not set");
  // Stored as base64-encoded PEM
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;
  return Buffer.from(raw, "base64").toString("utf-8");
}

async function getDelegatedAccessToken(impersonate: string): Promise<string> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!clientEmail) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL not set");
  const privateKeyPem = getPrivateKeyPem();
  const privateKey = createPrivateKey(privateKeyPem);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    sub: impersonate,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const headerEnc = base64UrlEncode(JSON.stringify(header));
  const payloadEnc = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${headerEnc}.${payloadEnc}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(privateKey);
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Token exchange failed for ${impersonate}: ${res.status} ${body.slice(0, 300)}`,
    );
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ============================================================
// Gmail search + subject parsing
// ============================================================

interface GmailListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
}

interface GmailMessageMetadata {
  id: string;
  internalDate: string; // ms epoch as string
  payload: {
    headers: Array<{ name: string; value: string }>;
  };
}

async function gmailListAll(
  accessToken: string,
  user: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let safety = 0; safety < 50; safety++) {
    const url = new URL(`${GMAIL_API}/users/${encodeURIComponent(user)}/messages`);
    url.searchParams.set("q", GMAIL_QUERY);
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Gmail list failed for ${user}: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as GmailListResponse;
    for (const m of data.messages ?? []) ids.push(m.id);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

async function gmailGetMetadata(
  accessToken: string,
  user: string,
  messageId: string,
): Promise<{ subject: string; orderedAt: Date } | null> {
  const url = new URL(
    `${GMAIL_API}/users/${encodeURIComponent(user)}/messages/${encodeURIComponent(messageId)}`,
  );
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "Subject");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as GmailMessageMetadata;
  const subject =
    data.payload.headers.find((h) => h.name.toLowerCase() === "subject")
      ?.value ?? "";
  if (!subject) return null;
  const internal = Number(data.internalDate);
  return {
    subject,
    orderedAt: Number.isFinite(internal) ? new Date(internal) : new Date(),
  };
}

const SUBJECT_REGEX =
  /EagleView Report\s+(\d+)\s*-\s*(.+?)\s*\((.+?),\s*\$([\d.]+),\s*(\d+)\s*sq\s*ft\)/i;

function parseSubject(
  subject: string,
  mailbox: string,
  messageId: string,
  orderedAt: Date,
): ParsedOrder | null {
  const m = subject.match(SUBJECT_REGEX);
  if (!m) return null;
  const [, reportId, rawAddress, productName, costStr, sqftStr] = m;
  const lower = productName.toLowerCase();
  let productCode: ParsedOrder["productCode"] = "OTHER";
  if (lower.includes("truedesign for planning")) productCode = "TDP";
  else if (lower.includes("truedesign for sales")) productCode = "TDS";
  else if (lower.includes("inform")) productCode = "IA";
  return {
    reportId: reportId.trim(),
    rawAddress: rawAddress.trim(),
    productName: productName.trim(),
    productCode,
    cost: Number(costStr),
    sqft: Number(sqftStr),
    orderedAt,
    sourceMailbox: mailbox,
    sourceMessageId: messageId,
  };
}

// ============================================================
// HubSpot deal matching
// ============================================================

interface HsDeal {
  id: string;
  properties: Record<string, string | null | undefined>;
}

async function fetchAllHubSpotDeals(): Promise<HsDeal[]> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) throw new Error("HUBSPOT_ACCESS_TOKEN not set");
  const all: HsDeal[] = [];
  let after: string | undefined;
  for (let safety = 0; safety < 200; safety++) {
    const body = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: "address_line_1",
              operator: "HAS_PROPERTY",
            },
          ],
        },
      ],
      properties: [
        "address_line_1",
        "city",
        "state",
        "postal_code",
        "site_survey_schedule_date",
      ],
      limit: 100,
      after,
    };
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HubSpot fetch failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      results: HsDeal[];
      paging?: { next?: { after: string } };
    };
    all.push(...data.results);
    after = data.paging?.next?.after;
    if (!after) break;
  }
  return all;
}

function normalizeAddressForMatch(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
}

interface DealIndex {
  byAddrCity: Map<string, string>; // "street|city" → dealId
}

function buildDealIndex(deals: HsDeal[]): DealIndex {
  const idx = new Map<string, string>();
  for (const d of deals) {
    const street = d.properties.address_line_1?.trim() ?? "";
    const city = d.properties.city?.trim() ?? "";
    if (!street || !city) continue;
    const key = `${normalizeAddressForMatch(street)}|${normalizeAddressForMatch(city)}`;
    if (!idx.has(key)) idx.set(key, d.id);
  }
  return { byAddrCity: idx };
}

/**
 * EV subject is "527 N Beaver Rd, Black Hawk, CO" — split street + city.
 * We tolerate whitespace + punctuation differences via normalization.
 */
function parseEvSubjectAddress(rawAddress: string): {
  street: string;
  city: string;
  state: string;
} | null {
  // Format: "<street>, <city>, <state>"
  const parts = rawAddress.split(",").map((s) => s.trim());
  if (parts.length < 3) return null;
  const street = parts[0] ?? "";
  const city = parts[1] ?? "";
  const state = parts[2] ?? "";
  if (!street || !city) return null;
  return { street, city, state };
}

function matchOrderToDeal(
  order: ParsedOrder,
  idx: DealIndex,
): string | null {
  const parsed = parseEvSubjectAddress(order.rawAddress);
  if (!parsed) return null;
  const key = `${normalizeAddressForMatch(parsed.street)}|${normalizeAddressForMatch(parsed.city)}`;
  return idx.byAddrCity.get(key) ?? null;
}

// ============================================================
// addressHash — must match @/lib/address-hash to interop with the
// auto-pull pipeline's idempotency check.
// ============================================================

import { createHash } from "crypto";

function addressHash(parts: {
  street: string;
  city: string;
  state: string;
  zip?: string;
}): string {
  const norm = (s: string | undefined) =>
    (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const key = [
    norm(parts.street),
    "", // unit (unknown from EV subject)
    norm(parts.city),
    norm(parts.state),
    norm(parts.zip),
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

// ============================================================
// Main
// ============================================================

async function main() {
  const prisma = new PrismaClient();
  const mailboxes = SINGLE_USER ? [SINGLE_USER] : MAILBOXES;

  console.log(
    `\nEagleView Gmail backfill — ${mailboxes.length} mailbox(es), DRY_RUN=${DRY_RUN}\n`,
  );

  // Pull all orders across mailboxes; dedupe by reportId.
  const orders = new Map<string, ParsedOrder>();
  let parseFailures = 0;

  for (const mailbox of mailboxes) {
    let token: string;
    try {
      token = await getDelegatedAccessToken(mailbox);
    } catch (err) {
      console.warn(`[${mailbox}] auth failed:`, (err as Error).message);
      continue;
    }
    let ids: string[];
    try {
      ids = await gmailListAll(token, mailbox);
    } catch (err) {
      console.warn(`[${mailbox}] list failed:`, (err as Error).message);
      continue;
    }
    console.log(`[${mailbox}] ${ids.length} matching messages`);
    let added = 0;
    for (const id of ids) {
      try {
        const meta = await gmailGetMetadata(token, mailbox, id);
        if (!meta) continue;
        const order = parseSubject(meta.subject, mailbox, id, meta.orderedAt);
        if (!order) {
          parseFailures += 1;
          continue;
        }
        // Dedupe — first mailbox wins for a given reportId
        if (!orders.has(order.reportId)) {
          orders.set(order.reportId, order);
          added += 1;
        }
      } catch (err) {
        console.warn(
          `[${mailbox}/${id}] metadata fetch failed:`,
          (err as Error).message,
        );
      }
    }
    console.log(`[${mailbox}] ${added} new unique orders parsed`);
  }

  console.log(
    `\nTotal unique orders: ${orders.size} (parse failures: ${parseFailures})\n`,
  );

  // Match against HubSpot
  console.log("Fetching HubSpot deals…");
  const deals = await fetchAllHubSpotDeals();
  console.log(`Fetched ${deals.length} deals`);
  const idx = buildDealIndex(deals);

  // Build insert payloads
  let matched = 0;
  let skipped = 0;
  let inserted = 0;
  let alreadyExisted = 0;

  for (const order of orders.values()) {
    const dealId = matchOrderToDeal(order, idx);
    if (!dealId) {
      skipped += 1;
      continue;
    }
    matched += 1;

    const parsed = parseEvSubjectAddress(order.rawAddress)!;
    const hash = addressHash({
      street: parsed.street,
      city: parsed.city,
      state: parsed.state,
    });

    if (DRY_RUN) {
      console.log(
        `[would insert] ${order.reportId} ${order.productCode} $${order.cost} ${order.rawAddress} → deal ${dealId}`,
      );
      continue;
    }

    try {
      await prisma.eagleViewOrder.upsert({
        where: { reportId: order.reportId },
        create: {
          dealId,
          productCode:
            order.productCode === "OTHER" ? "TDP" : order.productCode,
          reportId: order.reportId,
          addressHash: hash,
          status: "DELIVERED",
          triggeredBy: `historical_backfill:${order.sourceMailbox}`,
          orderedAt: order.orderedAt,
          deliveredAt: order.orderedAt, // best estimate — email is the delivery confirmation
          cost: order.cost,
        },
        update: {
          // Only update soft fields if row exists (don't clobber active orders)
          deliveredAt: order.orderedAt,
        },
      });
      inserted += 1;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("Unique constraint")) {
        alreadyExisted += 1;
      } else {
        console.warn(`[${order.reportId}] insert failed: ${msg}`);
      }
    }
  }

  console.log(
    `\n=== Summary ===\n` +
      `  Total orders parsed:  ${orders.size}\n` +
      `  Matched to a deal:    ${matched}\n` +
      `  Skipped (no match):   ${skipped}\n` +
      (DRY_RUN
        ? `  (dry run — no DB writes)`
        : `  Inserted:             ${inserted}\n` +
          `  Already existed:      ${alreadyExisted}`),
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
