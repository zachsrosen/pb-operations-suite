import { render } from "@react-email/render";
import { writeFileSync } from "fs";
import { prisma } from "../src/lib/db";
import { hubspotClient } from "../src/lib/hubspot";
import {
  PeDocDigest,
  type NearlyCompleteDeal,
  type NotUploadedDeal,
  type ActionRequiredDeal,
} from "../src/emails/PeDocDigest";

const TOTAL_DOCS_PER_DEAL = 15;
const PORTAL_ID = (process.env.HUBSPOT_PORTAL_ID || "21710069").replace(/[^0-9]/g, "") || "21710069";
const PTO_STAGE_ID = "20461940";
const CLOSEOUT_STAGE_ID = "24743347";
const PTO_SKIP_DOCS = [
  "Signed Interconnection Agreement",
  "Permission to Operate (PTO)",
];

async function main() {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const allDocs = await prisma.peDocumentReview.findMany({
    select: { dealId: true, docName: true, status: true, notes: true },
  });

  const dealDocs = new Map<string, { docName: string; status: string; notes: string | null }[]>();
  for (const doc of allDocs) {
    if (!dealDocs.has(doc.dealId)) dealDocs.set(doc.dealId, []);
    dealDocs.get(doc.dealId)!.push({ docName: doc.docName, status: doc.status, notes: doc.notes });
  }

  const allDealIds = [...dealDocs.keys()];
  const portalUrlMap = new Map<string, string>();
  const dealNameMap = new Map<string, string>();
  const dealStageMap = new Map<string, string>();
  const driveUrlMap = new Map<string, string>();
  let batchOk = 0;
  let batchMissingName = 0;
  try {
    const chunks = [];
    for (let i = 0; i < allDealIds.length; i += 100) chunks.push(allDealIds.slice(i, i + 100));
    for (const chunk of chunks) {
      const resp = await hubspotClient.crm.deals.batchApi.read({
        inputs: chunk.map((id) => ({ id })),
        properties: [
          "dealname", "dealstage", "pe_portal_url",
          "all_document_parent_folder_id", "g_drive", "all_document_folder_url",
        ],
        propertiesWithHistory: [],
      });
      for (const deal of resp.results) {
        const id = String(deal.id);
        batchOk++;
        if (deal.properties.pe_portal_url) portalUrlMap.set(id, deal.properties.pe_portal_url);
        if (deal.properties.dealname) dealNameMap.set(id, deal.properties.dealname);
        else batchMissingName++;
        if (deal.properties.dealstage) dealStageMap.set(id, deal.properties.dealstage);
        const folderId = deal.properties.all_document_parent_folder_id;
        const drive = folderId
          ? `https://drive.google.com/drive/folders/${folderId}`
          : (deal.properties.g_drive ?? deal.properties.all_document_folder_url);
        if (drive) driveUrlMap.set(id, drive);
      }
    }
  } catch (err) {
    console.error("Batch read failed:", err);
  }

  const hsUrl = (dealId: string) => `https://app.hubspot.com/contacts/${PORTAL_ID}/record/0-3/${dealId}`;
  const stageLabel = (dealId: string): string => {
    const stage = dealStageMap.get(dealId);
    if (stage === PTO_STAGE_ID) return "PTO";
    if (stage === CLOSEOUT_STAGE_ID) return "Close Out";
    return "Other";
  };
  const isTargetStage = (dealId: string): boolean => {
    const stage = dealStageMap.get(dealId);
    return stage === PTO_STAGE_ID || stage === CLOSEOUT_STAGE_ID;
  };

  const nearlyComplete: NearlyCompleteDeal[] = [];
  for (const [dealId, docs] of dealDocs.entries()) {
    if (!isTargetStage(dealId)) continue;
    const blocking = docs.filter((d) => d.status === "NOT_UPLOADED" || d.status === "ACTION_REQUIRED");
    if (blocking.length >= 1 && blocking.length <= 3 && docs.length >= TOTAL_DOCS_PER_DEAL - 3) {
      nearlyComplete.push({
        dealId,
        dealName: dealNameMap.get(dealId) ?? null,
        stage: stageLabel(dealId),
        approvedCount: docs.filter((d) => d.status === "APPROVED").length,
        inProgressCount: docs.filter((d) => d.status === "UPLOADED" || d.status === "UNDER_REVIEW").length,
        totalDocs: TOTAL_DOCS_PER_DEAL,
        missingDocs: blocking.map((d) => d.docName),
        hubspotUrl: hsUrl(dealId),
        pePortalUrl: portalUrlMap.get(dealId) ?? null,
        driveUrl: driveUrlMap.get(dealId) ?? null,
      });
    }
  }
  nearlyComplete.sort((a, b) => b.approvedCount - a.approvedCount);

  const notUploaded: NotUploadedDeal[] = [];
  for (const [dealId, docs] of dealDocs.entries()) {
    if (!isTargetStage(dealId)) continue;
    const isPto = dealStageMap.get(dealId) === PTO_STAGE_ID;
    const missing = docs
      .filter((d) => d.status === "NOT_UPLOADED")
      .filter((d) => !(isPto && PTO_SKIP_DOCS.includes(d.docName)))
      .map((d) => d.docName);
    if (missing.length > 0) {
      notUploaded.push({
        dealId,
        dealName: dealNameMap.get(dealId) ?? null,
        stage: stageLabel(dealId),
        missingDocs: missing,
        hubspotUrl: hsUrl(dealId),
        pePortalUrl: portalUrlMap.get(dealId) ?? null,
        driveUrl: driveUrlMap.get(dealId) ?? null,
      });
    }
  }
  notUploaded.sort((a, b) => b.missingDocs.length - a.missingDocs.length);

  const actionRequired: ActionRequiredDeal[] = [];
  for (const [dealId, docs] of dealDocs.entries()) {
    if (!isTargetStage(dealId)) continue;
    const issues = docs
      .filter((d) => d.status === "ACTION_REQUIRED" || d.status === "REJECTED")
      .map((d) => ({ docName: d.docName, status: d.status, notes: d.notes }));
    if (issues.length > 0) {
      actionRequired.push({
        dealId,
        dealName: dealNameMap.get(dealId) ?? null,
        stage: stageLabel(dealId),
        issues,
        hubspotUrl: hsUrl(dealId),
        pePortalUrl: portalUrlMap.get(dealId) ?? null,
        driveUrl: driveUrlMap.get(dealId) ?? null,
      });
    }
  }
  actionRequired.sort((a, b) => b.issues.length - a.issues.length);

  const dateStr = todayStart.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver",
  });

  const html = await render(
    PeDocDigest({
      date: dateStr,
      totalDealsTracked: dealDocs.size,
      nearlyComplete,
      notUploaded,
      actionRequired,
      changes: [],
      reportUrl: "https://pbtechops.com/dashboards/pe-docs",
    }),
  );

  writeFileSync("/tmp/pe-digest-preview.html", html);

  // Diagnostics
  console.log(`Deals tracked: ${dealDocs.size}`);
  console.log(`HubSpot batch results: ${batchOk}, missing dealname: ${batchMissingName}`);
  console.log(`Names resolved: ${dealNameMap.size}, portal URLs: ${portalUrlMap.size}, drive URLs: ${driveUrlMap.size}, stages: ${dealStageMap.size}`);
  console.log(`Sections — nearlyComplete: ${nearlyComplete.length}, notUploaded: ${notUploaded.length}, actionRequired: ${actionRequired.length} (changes omitted from daily digest)`);
  const sample = [...nearlyComplete, ...notUploaded, ...actionRequired].slice(0, 5);
  console.log("Sample resolved deals:");
  for (const d of sample) {
    console.log(`  ${d.dealId} → name="${d.dealName ?? "(null)"}" stage=${d.stage} pePortal=${d.pePortalUrl ? "yes" : "NO"} drive=${d.driveUrl ? "yes" : "NO"}`);
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
