// SOP <-> live-automation drift detector.
// Ported faithfully from data/hubspot-flows/build_worklist.py (the verified oracle):
// `clean`, `doc_names_from_section`, `norm`, the clone-collapse, and the three-bucket
// comparison (documented-but-OFF, documented-but-missing, live-but-undocumented).
// Matching mirrors the Python so buckets line up with docs/hubspot-stage-mismatch-worklist.md.

export type DriftResult = {
  documentedButOff: string[];
  documentedButMissing: string[];
  liveButUndocumented: string[];
};

// Python `clean`: strip tags, decode the handful of entities the SOP uses, collapse whitespace.
function clean(s: string): string {
  let out = s.replace(/<[^>]+>/g, " ");
  const entities: [string, string][] = [
    ["&amp;", "&"],
    ["&gt;", ">"],
    ["&lt;", "<"],
    ["&nbsp;", " "],
    ["&#39;", "'"],
    ["&quot;", '"'],
  ];
  for (const [a, b] of entities) out = out.split(a).join(b);
  return out.replace(/\s+/g, " ").trim();
}

// Python `doc_names_from_section`: for each <table> whose header's FIRST cell is "Workflow",
// take the first <td> of every body row as a documented workflow name.
function docNamesFromSection(html: string): string[] {
  const names: string[] = [];
  const tableRe = /<table>([\s\S]*?)<\/table>/g;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    const tbl = tm[1];
    const hdr = /<tr>(<th[\s\S]*?)<\/tr>/.exec(tbl);
    if (!hdr) continue;
    const hcells: string[] = [];
    const thRe = /<th[^>]*>([\s\S]*?)<\/th>/g;
    let hm: RegExpExecArray | null;
    while ((hm = thRe.exec(hdr[1])) !== null) hcells.push(clean(hm[1]));
    if (hcells.length && hcells[0].toLowerCase() === "workflow") {
      const rowRe = /<tr><td>([\s\S]*?)<\/td>/g;
      let rm: RegExpExecArray | null;
      while ((rm = rowRe.exec(tbl)) !== null) {
        const nm = clean(rm[1]);
        if (nm) names.push(nm);
      }
    }
  }
  return names;
}

// Python `norm`: lowercase, strip (#N), strip ZRS/WMS, strip leading "NN." / "NNa" numbering,
// turn pipes into spaces, collapse to alphanumerics + single spaces.
function norm(s: string): string {
  let out = s.toLowerCase();
  out = out.replace(/\(#\d+\)/g, "");
  out = out.replace(/\b(zrs|wms)\b/g, "");
  out = out.replace(/^\s*\d{1,2}[a-z]?\s*[.\-]\s*/, "");
  out = out.replace(/[|]/g, " ");
  out = out.replace(/[^a-z0-9 ]/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

// Python clone-collapse: strip trailing " (#N)" so clones fold into one base flow.
const CLONE_RE = /\s*\(#\d+\)\s*$/;

export function detectDrift(
  sopSectionHtmls: string[],
  liveStageFlows: { name: string; isEnabled: boolean }[],
): DriftResult {
  // Collapse clones in live flows; a base is ON if any of its clones is ON.
  const live: Record<string, { on: boolean }> = {};
  for (const f of liveStageFlows) {
    const base = f.name.replace(CLONE_RE, "").trim();
    const e = (live[base] ??= { on: false });
    e.on = e.on || f.isEnabled;
  }

  // Documented names aggregated across the section HTMLs (dedup by normalized form, last wins --
  // matches the Python dict build `doc_set[norm(dn)] = dn`).
  const docSet: Record<string, string> = {};
  for (const html of sopSectionHtmls) {
    for (const dn of docNamesFromSection(html)) docSet[norm(dn)] = dn;
  }

  const liveNorm: Record<string, string> = {};
  for (const base of Object.keys(live)) liveNorm[norm(base)] = base;

  const documentedButOff: string[] = [];
  const documentedButMissing: string[] = [];

  for (const [dnorm, draw] of Object.entries(docSet)) {
    let match: string | null = null;
    for (const [lnorm, lraw] of Object.entries(liveNorm)) {
      if (dnorm && (dnorm === lnorm || dnorm.includes(lnorm) || lnorm.includes(dnorm))) {
        match = lraw;
        break;
      }
    }
    if (match === null) documentedButMissing.push(draw);
    else if (!live[match].on) documentedButOff.push(draw);
  }

  const docNorms = Object.keys(docSet);
  const liveButUndocumented: string[] = [];
  for (const [base, info] of Object.entries(live)) {
    if (!info.on) continue;
    const bn = norm(base);
    const documented = docNorms.some((dn) => bn === dn || bn.includes(dn) || dn.includes(bn));
    if (!documented) liveButUndocumented.push(base);
  }

  return { documentedButOff, documentedButMissing, liveButUndocumented };
}
