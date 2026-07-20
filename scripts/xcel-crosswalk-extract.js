/* ============================================================
   Xcel portal -> Case# / IA# crosswalk extractor  (one-time backfill)

   WHY: chatter notification emails carry only the IA number (IA160801).
   HubSpot carries only the Case number (06405260, in utility_application__).
   The two numbers only coexist inside the portal, so we harvest the pairing
   here once, stamp it on the deals, and every chatter email becomes linkable.

   HOW IT WORKS
   1. Hooks the page's own network calls and harvests the list view's data
      responses. This avoids scraping the virtualized Lightning table, whose
      cells and record ids are not reliably paired in the DOM.
   2. Resolves each record id to its IA number using the canonical-URL
      redirect (/interconnection-application/<id> redirects to .../<ia#>).
      Verified working against a874O000000PSYU -> IA160801.
   3. Emits CSV.

   USAGE (Chrome DevTools console, on the portal, while logged in)
   1. Open the Interconnection Applications list view.
   2. Paste this whole file into the console, press Enter.
   3. Page through EVERY page of the list (and any other list views /
      CO + CA) so the hook sees all rows. Scroll to trigger lazy loads.
   4. piCrosswalk.status()          -> how many rows captured so far
   5. await piCrosswalk.resolveAll() -> fetch IA numbers (throttled, be patient)
   6. piCrosswalk.copy()            -> CSV on your clipboard

   NOTE: step 5 makes one request per application, throttled to ~4/sec by
   default. Leave it running. If Xcel rate-limits, raise the delay:
   await piCrosswalk.resolveAll(600)
   ============================================================ */

(() => {
  const RECORDS = new Map(); // recordId -> { caseNum, iaNumber }
  const RECORD_ID = /^a87[a-zA-Z0-9]{12,15}$/;
  const CASE_NUM = /^0\d{7}$/;

  // ---------- 1. capture the list view's own data responses ----------
  function harvest(text) {
    if (!text) return;
    let data;
    try {
      data = JSON.parse(String(text).replace(/^while\s*\(1\);?/, ""));
    } catch {
      return; // not JSON, ignore
    }
    walk(data);
  }

  function findCaseNumber(obj) {
    for (const v of Object.values(obj)) {
      if (typeof v === "string" && CASE_NUM.test(v)) return v;
      // Salesforce often wraps field values as { value: "..." }
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = v.value ?? v.displayValue;
        if (typeof inner === "string" && CASE_NUM.test(inner)) return inner;
      }
    }
    return null;
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const id = node.Id ?? node.id ?? node.recordId;
    if (typeof id === "string" && RECORD_ID.test(id)) {
      const caseNum = findCaseNumber(node);
      const prev = RECORDS.get(id) ?? {};
      RECORDS.set(id, { ...prev, ...(caseNum ? { caseNum } : {}) });
    }
    for (const v of Object.values(node)) walk(v);
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__url = String(url || "");
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__url.includes("/sfsites/aura")) {
      this.addEventListener("load", () => harvest(this.responseText));
    }
    return origSend.call(this, body);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url && String(url).includes("/sfsites/aura")) {
        res.clone().text().then(harvest).catch(() => {});
      }
    } catch {}
    return res;
  };

  // ---------- 2. record id -> IA number, via canonical-URL redirect ----------
  async function resolveIA(recordId) {
    try {
      const r = await fetch(
        `/Renewables/s/interconnection-application/${recordId}`,
        { redirect: "follow" },
      );
      const m = r.url.match(/\/(ia\d+)\b/i);
      return m ? m[1].toUpperCase() : null;
    } catch {
      return null;
    }
  }

  // ---------- 3. public API ----------
  window.piCrosswalk = {
    status() {
      const all = [...RECORDS.values()];
      const s = {
        recordsSeen: all.length,
        withCaseNumber: all.filter((v) => v.caseNum).length,
        withIaNumber: all.filter((v) => v.iaNumber).length,
      };
      console.table(s);
      return s;
    },

    /** Fetch IA numbers for every captured record. Throttled. */
    async resolveAll(delayMs = 250) {
      const todo = [...RECORDS.entries()].filter(([, v]) => !v.iaNumber);
      console.log(`Resolving ${todo.length} record(s) -> IA number...`);
      let done = 0;
      for (const [id, v] of todo) {
        v.iaNumber = await resolveIA(id);
        RECORDS.set(id, v);
        if (++done % 10 === 0) console.log(`  ${done}/${todo.length}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
      console.log("Done.");
      return this.status();
    },

    rows() {
      return [...RECORDS.entries()]
        .map(([recordId, v]) => ({ recordId, ...v }))
        .filter((r) => r.caseNum && r.iaNumber);
    },

    csv() {
      const header = "case_number,ia_number,record_id";
      return [header, ...this.rows().map((r) => `${r.caseNum},${r.iaNumber},${r.recordId}`)].join("\n");
    },

    /** Chrome console helper: puts the CSV on your clipboard. */
    copy() {
      const csv = this.csv();
      if (typeof copy === "function") {
        copy(csv);
        console.log(`Copied ${this.rows().length} crosswalk rows to clipboard.`);
      } else {
        console.log(csv);
      }
      return this.rows().length;
    },

    /** If the harvest heuristic misses the case number, dump a raw sample
     *  so the field path can be corrected. */
    debugSample() {
      const withoutCase = [...RECORDS.entries()].filter(([, v]) => !v.caseNum);
      console.log(`records missing a case number: ${withoutCase.length}`);
      console.log(withoutCase.slice(0, 5));
    },
  };

  console.log(
    "%cXcel crosswalk capture armed.",
    "color:#16a34a;font-weight:bold;font-size:13px",
  );
  console.log("1) Page through the whole list (all pages, CO + CA views).");
  console.log("2) piCrosswalk.status()");
  console.log("3) await piCrosswalk.resolveAll()");
  console.log("4) piCrosswalk.copy()   <- CSV to clipboard");
})();
