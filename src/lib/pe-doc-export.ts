// ---------------------------------------------------------------------------
// PE Document Tracker — export helpers (pure, no DOM/clipboard here)
//
// Turns the dashboard's outstanding-doc rows into either a CSV (for spreadsheet
// tracking) or a readable text block grouped by deal (for pasting straight into
// an email / Google Chat / HubSpot task to a team). Used by the Copy / CSV
// buttons in each DocsTab view.
// ---------------------------------------------------------------------------

export interface PeExportRow {
  proj: string;
  deal: string;
  location: string;
  stage: string;
  team: string;
  doc: string;
  status: string;
  reason: string;
  blockerNote: string;
  hubspotUrl: string;
  portalUrl: string;
  driveUrl: string;
}

// "PROJ-9495 | Hylsky, Kenneth | 123 Main St, ..." -> { proj, name }
export function parseDealName(full: string): { proj: string; name: string } {
  const parts = full.split("|").map((s) => s.trim());
  const proj = parts[0]?.match(/PROJ-\d+/i)?.[0] ?? "";
  const name = parts[1] || parts[0] || full;
  return { proj, name };
}

// Strip PE sync metadata, keep the genuine reviewer reason. Mirrors the
// rejection-note cleaning used by the accounting PE analytics route.
export function cleanPeNote(note: string | null | undefined): string {
  if (!note) return "";
  const code = note.match(/\[H\d+\][^"]*?:[^."]*\./);
  if (code) return code[0].trim().replace(/\s+/g, " ");
  const stripped = note
    .replace(/Synced from PE (?:API|portal scraper) \([^)]*\)/gi, "")
    .replace(/\bv\d+\b/gi, "")
    .replace(/milestone:[^|]*/gi, "")
    .replace(/submitted:\s*\S+/gi, "")
    .replace(/responded:\s*\S+/gi, "")
    .replace(/approver:\s*(?:page\s*\d+|[\d/]+)/gi, "")
    .replace(/\s+\|\s+/g, " · ")
    .replace(/^[\s|·—-]+|[\s|·—-]+$/g, "")
    .trim();
  return stripped.length > 3 ? stripped : "";
}

function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function rowsToCsv(rows: PeExportRow[]): string {
  const head = [
    "Project", "Deal", "Location", "Stage", "Team", "Document",
    "Status", "PE Reason", "Blocker Note", "HubSpot", "PE Portal", "Drive",
  ];
  const lines = rows.map((r) =>
    [r.proj, r.deal, r.location, r.stage, r.team, r.doc, r.status, r.reason, r.blockerNote, r.hubspotUrl, r.portalUrl, r.driveUrl]
      .map((x) => csvCell(x ?? ""))
      .join(","),
  );
  return [head.join(","), ...lines].join("\r\n");
}

// Readable block grouped by deal — for pasting into email / chat / a task.
export function rowsToText(rows: PeExportRow[], title: string): string {
  const byDeal = new Map<string, PeExportRow[]>();
  for (const r of rows) {
    const list = byDeal.get(r.deal) ?? [];
    list.push(r);
    byDeal.set(r.deal, list);
  }
  const lines: string[] = [`${title} (${byDeal.size} deal${byDeal.size === 1 ? "" : "s"})`];
  for (const [deal, rs] of byDeal) {
    const first = rs[0];
    const proj = first.proj ? ` (${first.proj})` : "";
    lines.push("");
    lines.push(`• ${parseDealName(deal).name || deal}${proj} — ${first.stage}${first.location ? ` · ${first.location}` : ""}`);
    for (const r of rs) {
      lines.push(`    - ${r.doc}: ${r.status}${r.reason ? ` — ${r.reason}` : ""}${r.blockerNote ? ` [blocked: ${r.blockerNote}]` : ""}`);
    }
    const links = [
      first.hubspotUrl && `HubSpot: ${first.hubspotUrl}`,
      first.portalUrl && `Portal: ${first.portalUrl}`,
    ].filter(Boolean).join("  |  ");
    if (links) lines.push(`    ${links}`);
  }
  return lines.join("\n");
}
