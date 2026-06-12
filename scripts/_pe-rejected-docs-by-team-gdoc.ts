/**
 * Google Doc: all PE docs currently rejected / action-required, grouped by
 * owning team → doc type → checkbox per deal, with PE's reviewer note inline
 * and HubSpot / PE / Drive links.
 *
 * Run: npx tsx --env-file=.env scripts/_pe-rejected-docs-by-team-gdoc.ts [existingDocId]
 */
import { prisma } from "../src/lib/db";
import { searchWithRetry } from "../src/lib/hubspot";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { PIPELINE_IDS } from "../src/lib/deals-pipeline";
import { PE_M1_DOC_NAMES } from "../src/lib/pe-analytics";
import { getServiceAccountToken } from "../src/lib/google-auth";

const PTO = "20461940";
const CLOSEOUT = "24743347";
const COMPLETE = "20440343";
const M2_DOCS = ["Signed Interconnection Agreement", "Conditional Waiver — Final Payment", "Permission to Operate (PTO)"];

// Owning team per doc type (folder-source based; adjust as the org sees fit).
const TEAMS: { team: string; docs: string[] }[] = [
  { team: "Sales / Onboarding", docs: ["Customer Agreement (PPA/ESA)", "Installation Order", "State Disclosures", "Utility Bill", "Signed Proposal"] },
  { team: "Design", docs: ["Design Plan"] },
  { team: "Field Ops / Commissioning", docs: ["Photos per Policy", "Access to Monitoring"] },
  { team: "Permitting / Inspections", docs: ["Signed Final Permit"] },
  { team: "Interconnection", docs: ["Signed Interconnection Agreement", "Permission to Operate (PTO)"] },
  { team: "Accounting / Turnover (PandaDoc forms)", docs: ["Certificate of Acceptance", "Attestation of Customer Payment", "Conditional Progress Lien Waiver", "Conditional Waiver — Final Payment"] },
];

async function main() {
  const deals: { id: string; p: Record<string, string | null> }[] = [];
  let after: string | undefined;
  do {
    const res = await searchWithRetry({
      filterGroups: [{ filters: [
        { propertyName: "pipeline", operator: FilterOperatorEnum.Eq, value: PIPELINE_IDS.project },
        { propertyName: "tags", operator: FilterOperatorEnum.ContainsToken, value: "Participate Energy" },
      ]}],
      properties: ["dealname", "dealstage", "pe_portal_url", "design_documents", "g_drive", "all_document_parent_folder_id"],
      limit: 100,
      ...(after ? { after } : {}),
    } as never);
    for (const d of res.results) deals.push({ id: d.id, p: d.properties as Record<string, string | null> });
    after = res.paging?.next?.after;
  } while (after);
  const staged = new Map(deals.filter((d) => d.p.dealstage === PTO || d.p.dealstage === CLOSEOUT || d.p.dealstage === COMPLETE).map((d) => [d.id, d]));

  const docs = await prisma.peDocumentReview.findMany({ select: { dealId: true, docName: true, status: true, notes: true } });
  const m1Set = new Set<string>(PE_M1_DOC_NAMES);

  // docName -> deals missing it
  interface MissingDeal { name: string; hs: string; pe: string; drive: string; m: string; note: string }
  const missingByDoc = new Map<string, MissingDeal[]>();
  for (const r of docs) {
    if (r.status !== "ACTION_REQUIRED" && r.status !== "REJECTED") continue;
    const deal = staged.get(r.dealId);
    if (!deal) continue;
    const owed = deal.p.dealstage !== PTO || m1Set.has(r.docName);
    if (!owed) continue;
    const note = (r.notes ?? "")
      .replace(/^Synced from PE portal scraper \([^)]*\)\s*\|\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    const drive = deal.p.design_documents || (deal.p.all_document_parent_folder_id ? "https://drive.google.com/drive/folders/" + deal.p.all_document_parent_folder_id : deal.p.g_drive) || "";
    (missingByDoc.get(r.docName) ?? missingByDoc.set(r.docName, []).get(r.docName)!).push({
      name: (deal.p.dealname || r.dealId).split("|").slice(0, 2).join("|").trim(),
      hs: "https://app.hubspot.com/contacts/21710069/record/0-3/" + r.dealId,
      pe: deal.p.pe_portal_url || "",
      drive,
      m: m1Set.has(r.docName) ? "M1" : "M2",
      note,
    });
  }
  for (const list of missingByDoc.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const totalDocs = [...missingByDoc.values()].reduce((s, l) => s + l.length, 0);
  const totalDeals = new Set([...missingByDoc.values()].flat().map((d) => d.hs)).size;
  console.log(`rejected/action-required docs: ${totalDocs} across ${totalDeals} deals`);

  // ---- Build doc content ----
  const title = `PE — Rejected / Action-Required Documents by Team (${totalDocs} docs · ${totalDeals} deals) — 2026-06-12\n`;
  const intro = `Docs PE has bounced back with action items — the reviewer's note is on each row. Check off each as the fix is re-uploaded. Team mapping is folder-source based — flag Zach if a doc belongs to a different team.\n`;
  let text = title + intro;
  const headings: { start: number; end: number; style: string }[] = [{ start: 1, end: 1 + title.length, style: "HEADING_2" }];
  const bulletRanges: { start: number; end: number }[] = [];
  const links: { start: number; end: number; url: string }[] = [];

  for (const { team, docs: docNames } of TEAMS) {
    const groups = docNames
      .map((dn) => ({ dn, list: missingByDoc.get(dn) ?? [] }))
      .filter((g) => g.list.length > 0);
    if (groups.length === 0) continue;
    const teamCount = groups.reduce((s, g) => s + g.list.length, 0);
    const teamLine = `\n${team} — ${teamCount} need fixing\n`;
    headings.push({ start: 1 + text.length + 1, end: 1 + text.length + teamLine.length, style: "HEADING_3" });
    text += teamLine;
    for (const g of groups) {
      const docLine = `${g.dn} (${g.list.length})\n`;
      headings.push({ start: 1 + text.length, end: 1 + text.length + docLine.length, style: "HEADING_4" });
      text += docLine;
      const blockStart = 1 + text.length;
      for (const d of g.list) {
        let line = `${d.name} — ${d.m}${d.note ? ` — fix: ${d.note}` : ""}   `;
        const addLink = (label: string, url: string) => {
          if (!url) return;
          links.push({ start: 1 + text.length + line.length, end: 1 + text.length + line.length + label.length, url });
          line += label + "  ";
        };
        addLink("HubSpot", d.hs);
        addLink("PE Portal", d.pe);
        addLink("Drive", d.drive);
        text += line.trimEnd() + "\n";
      }
      bulletRanges.push({ start: blockStart, end: 1 + text.length - 1 });
    }
  }

  const token = await getServiceAccountToken(["https://www.googleapis.com/auth/drive"], "zach@photonbrothers.com");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  let documentId = process.argv[2];
  if (documentId) {
    const existing = (await (await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, { headers })).json()) as { body?: { content?: { endIndex?: number }[] } };
    const content = existing.body?.content ?? [];
    const endIndex = content[content.length - 1]?.endIndex ?? 2;
    if (endIndex > 2) {
      await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
        method: "POST", headers,
        body: JSON.stringify({ requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }] }),
      });
    }
  } else {
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST", headers, body: JSON.stringify({ title: "PE — Rejected Documents by Team (2026-06-12)" }),
    });
    const doc = (await createRes.json()) as { documentId?: string };
    if (!doc.documentId) throw new Error("doc create failed");
    documentId = doc.documentId;
  }

  const requests: unknown[] = [
    { insertText: { location: { index: 1 }, text } },
    ...headings.map((h) => ({
      updateParagraphStyle: { range: { startIndex: h.start, endIndex: h.end }, paragraphStyle: { namedStyleType: h.style }, fields: "namedStyleType" },
    })),
    ...bulletRanges.map((b) => ({ createParagraphBullets: { range: { startIndex: b.start, endIndex: b.end }, bulletPreset: "BULLET_CHECKBOX" } })),
    ...links.map((l) => ({
      updateTextStyle: {
        range: { startIndex: l.start, endIndex: l.end },
        textStyle: { link: { url: l.url }, foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.06, green: 0.45 } } }, underline: true },
        fields: "link,foregroundColor,underline",
      },
    })),
  ];
  const upd = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: "POST", headers, body: JSON.stringify({ requests }),
  });
  if (!upd.ok) throw new Error("batchUpdate failed: " + (await upd.text()).slice(0, 400));

  await fetch(`https://www.googleapis.com/drive/v3/files/${documentId}/permissions`, {
    method: "POST", headers, body: JSON.stringify({ type: "domain", domain: "photonbrothers.com", role: "writer" }),
  });
  console.log("DOC URL: https://docs.google.com/document/d/" + documentId + "/edit");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
