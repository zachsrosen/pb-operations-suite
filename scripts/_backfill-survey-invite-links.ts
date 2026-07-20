/**
 * One-time backfill: recover the raw self-scheduling link for historical
 * SurveyInvites and store it in SurveyInvite.schedulingUrl.
 *
 * We only ever persisted the token HASH, so the raw link can't be derived —
 * it only survives in the sent invite emails. Olivia sends those from
 * hello@photonbrothers.com, so we read that mailbox's Sent folder (via the
 * app's Workspace domain-wide delegation), pull each /portal/survey/{token}
 * link, hash the token, and match it EXACTLY to SurveyInvite.tokenHash.
 *
 * REQUIRES: the service account's domain-wide delegation must include
 *   https://www.googleapis.com/auth/gmail.readonly
 * (add it in Workspace Admin → Security → API Controls → Domain-wide
 * Delegation). Without it the token mint fails with unauthorized_client.
 *
 * Dry-run (default):  npx tsx scripts/_backfill-survey-invite-links.ts
 * Apply:              npx tsx scripts/_backfill-survey-invite-links.ts --apply
 */
import "dotenv/config";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { getServiceAccountToken } from "../src/lib/google-auth";
import { hashToken } from "../src/lib/portal-token";

const APPLY = process.argv.includes("--apply");
const MAILBOX = "hello@photonbrothers.com";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

async function gmail(path: string, token: string) {
  const res = await fetch(`${GMAIL}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectText(part: any): string {
  let t = "";
  if (part?.body?.data) t += Buffer.from(part.body.data, "base64").toString("utf8");
  for (const p of part?.parts || []) t += collectText(p);
  return t;
}

async function main() {
  let token: string;
  try {
    token = await getServiceAccountToken(["https://www.googleapis.com/auth/gmail.readonly"], MAILBOX);
  } catch (e) {
    console.error(
      `Cannot read ${MAILBOX}: ${(e as Error).message}\n` +
        "Add the gmail.readonly scope to the service account's domain-wide delegation, then re-run.",
    );
    process.exit(2);
  }

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }) });

  // Pull invite messages from the Sent folder, paging through all of them.
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const q = encodeURIComponent('in:sent "portal/survey"');
    const page = await gmail(`/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`, token);
    for (const m of page.messages || []) ids.push(m.id);
    pageToken = page.nextPageToken;
  } while (pageToken);
  console.log(`Found ${ids.length} sent messages containing a portal/survey link (${APPLY ? "APPLY" : "dry-run"}).`);

  const linkByHash = new Map<string, string>();
  for (const id of ids) {
    const msg = await gmail(`/messages/${id}?format=full`, token);
    const body = collectText(msg.payload || {});
    // Capture the full URL + token; take the first survey link per email.
    const m = body.match(/https?:\/\/[^\s"'<>]+\/portal\/survey\/([A-Za-z0-9_-]+)/);
    if (!m) continue;
    const url = m[0];
    const rawToken = m[1];
    linkByHash.set(hashToken(rawToken), url);
  }
  console.log(`Extracted ${linkByHash.size} unique token links.`);

  // Match to invites missing a stored link.
  const invites = await prisma.surveyInvite.findMany({
    where: { schedulingUrl: null },
    select: { id: true, tokenHash: true, customerName: true, dealId: true },
  });
  let matched = 0;
  for (const inv of invites) {
    const url = linkByHash.get(inv.tokenHash);
    if (!url) continue;
    matched++;
    console.log(`  ${APPLY ? "SET" : "would set"} ${inv.customerName || inv.dealId} → ${url.slice(0, 60)}…`);
    if (APPLY) {
      await prisma.surveyInvite.update({ where: { id: inv.id }, data: { schedulingUrl: url } });
    }
  }
  console.log(
    `\n${APPLY ? `Backfilled ${matched}` : `Would backfill ${matched}`} of ${invites.length} link-less invites.` +
      ` ${invites.length - matched} had no recoverable email.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
