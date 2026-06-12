/**
 * Google Doc: PE docs currently rejected / action-required, grouped BY DEAL —
 * one checkbox per deal (a complete fix-packet), reviewer notes per doc on
 * sub-lines, HubSpot / PE / Drive links.
 *
 * Run: npx tsx --env-file=.env scripts/_pe-rejected-docs-by-deal-gdoc.ts [existingDocId]
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
const SHORT: Record<string, string> = {
  "Customer Agreement (PPA/ESA)": "CustAgmt", "Installation Order": "InstOrder", "State Disclosures": "Disclosures",
  "Utility Bill": "UtilBill", "Signed Proposal": "Proposal", "Design Plan": "Design", "Photos per Policy": "Photos",
  "Signed Final Permit": "Permit", "Access to Monitoring": "Monitoring", "Certificate of Acceptance": "CoA",
  "Attestation of Customer Payment": "Attestation", "Conditional Progress Lien Waiver": "ProgLien",
  "Signed Interconnection Agreement": "IC Agmt", "Conditional Waiver — Final Payment": "FinalLien", "Permission to Operate (PTO)": "PTO",
};

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
  interface Item { doc: string; note: string }
  const byDeal = new Map<string, Item[]>();
  for (const r of docs) {
    if (r.status !== "ACTION_REQUIRED" && r.status !== "REJECTED") continue;
    const deal = staged.get(r.dealId);
    if (!deal) continue;
    const owed = deal.p.dealstage !== PTO || m1Set.has(r.docName);
    if (!owed) continue;
    const note = (r.notes ?? "").replace(/^Synced from PE portal scraper \([^)]*\)\s*\|\s*/, "").replace(/\s+/g, " ").trim().slice(0, 180);
    (byDeal.get(r.dealId) ?? byDeal.set(r.dealId, []).get(r.dealId)!).push({ doc: SHORT[r.docName] ?? r.docName, note });
  }
  const rows = [...byDeal.entries()].map(([id, items]) => {
    const deal = staged.get(id)!;
    const drive = deal.p.design_documents || (deal.p.all_document_parent_folder_id ? "https://drive.google.com/drive/folders/" + deal.p.all_document_parent_folder_id : deal.p.g_drive) || "";
    return {
      name: (deal.p.dealname || id).split("|").slice(0, 2).join("|").trim(),
      items,
      hs: "https://app.hubspot.com/contacts/21710069/record/0-3/" + id,
      pe: deal.p.pe_portal_url || "",
      drive,
    };
  });
  rows.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  const totalDocs = rows.reduce((s, r) => s + r.items.length, 0);
  console.log(`rejected docs: ${totalDocs} across ${rows.length} deals`);

  // ---- Content: one checkbox PARAGRAPH per deal ( = in-paragraph line break)
  const title = `PE — Rejected / Action-Required Docs by Deal (${totalDocs} docs · ${rows.length} deals) — 2026-06-12\n`;
  const intro = `One checkbox per deal — fix every doc listed, resubmit the package, then check it off. PE's reviewer note follows each doc.\n`;
  let text = title + intro;
  const links: { start: number; end: number; url: string }[] = [];
  const noteRanges: { start: number; end: number }[] = [];
  const bulletStart = 1 + text.length;
  for (const r of rows) {
    let para = `${r.name} — ${r.items.length} doc${r.items.length > 1 ? "s" : ""} need fixing   `;
    const addLink = (label: string, url: string) => {
      if (!url) return;
      links.push({ start: 1 + text.length + para.length, end: 1 + text.length + para.length + label.length, url });
      para += label + "  ";
    };
    addLink("HubSpot", r.hs);
    addLink("PE Portal", r.pe);
    addLink("Drive", r.drive);
    para = para.trimEnd();
    for (const it of r.items) {
      const noteLine = `      [${it.doc}] ${it.note}`;
      noteRanges.push({ start: 1 + text.length + para.length + 1, end: 1 + text.length + para.length + noteLine.length });
      para += noteLine;
    }
    text += para + "\n";
  }
  const bulletEnd = 1 + text.length - 1;

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
      method: "POST", headers, body: JSON.stringify({ title: "PE — Rejected Docs by Deal (2026-06-12)" }),
    });
    const doc = (await createRes.json()) as { documentId?: string };
    if (!doc.documentId) throw new Error("doc create failed");
    documentId = doc.documentId;
  }

  const requests: unknown[] = [
    { insertText: { location: { index: 1 }, text } },
    { updateParagraphStyle: { range: { startIndex: 1, endIndex: 1 + title.length }, paragraphStyle: { namedStyleType: "HEADING_2" }, fields: "namedStyleType" } },
    { createParagraphBullets: { range: { startIndex: bulletStart, endIndex: bulletEnd }, bulletPreset: "BULLET_CHECKBOX" } },
    ...links.map((l) => ({
      updateTextStyle: {
        range: { startIndex: l.start, endIndex: l.end },
        textStyle: { link: { url: l.url }, foregroundColor: { color: { rgbColor: { blue: 0.8, red: 0.06, green: 0.45 } } }, underline: true },
        fields: "link,foregroundColor,underline",
      },
    })),
    ...noteRanges.map((n) => ({
      updateTextStyle: {
        range: { startIndex: n.start, endIndex: n.end },
        textStyle: { foregroundColor: { color: { rgbColor: { red: 0.42, green: 0.42, blue: 0.42 } } }, fontSize: { magnitude: 9, unit: "PT" } },
        fields: "foregroundColor,fontSize",
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
