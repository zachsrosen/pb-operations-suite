# Pre-Sale Survey Scheduling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow salespeople to search Sales Pipeline deals and schedule pre-sale site surveys using the existing survey scheduler, with full Zuper job creation and HubSpot write-back.

**Architecture:** Add a tab toggle to the site-survey-scheduler page switching between "Ops Surveys" and "Pre-Sale" modes. Pre-sale mode replaces the sidebar project list with a deal search box that hits a new `/api/deals/search` endpoint querying the HubSpot Sales Pipeline. When a deal is selected, the existing scheduling flow (calendar, surveyor picker, slot system) is reused. On confirm, the schedule API creates a new Zuper job (not reschedule-only) and updates HubSpot.

**Tech Stack:** Next.js API routes, HubSpot Search API, existing Zuper integration, React state management

---

### Task 1: Create `/api/deals/search` API Route

**Files:**
- Create: `src/app/api/deals/search/route.ts`

**Step 1: Create the search API route**

This route searches the HubSpot Sales Pipeline by deal name or address using the existing `searchWithRetry` pattern from `src/app/api/deals/route.ts`.

```typescript
import { NextRequest, NextResponse } from "next/server";
import { Client } from "@hubspot/api-client";
import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/deals";
import { requireApiAuth } from "@/lib/api-auth";
import { STAGE_MAPS } from "@/lib/deals-pipeline";

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
  numberOfApiCallRetries: 1,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchWithRetry(
  searchRequest: Parameters<typeof hubspotClient.crm.deals.searchApi.doSearch>[0],
  maxRetries = 3
) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await hubspotClient.crm.deals.searchApi.doSearch(searchRequest);
    } catch (error: unknown) {
      const isRateLimit =
        error instanceof Error &&
        (error.message.includes("429") || error.message.includes("rate") || error.message.includes("secondly"));
      const statusCode = (error as { code?: number })?.code;
      if ((isRateLimit || statusCode === 429) && attempt < maxRetries - 1) {
        await sleep(Math.pow(2, attempt + 1) * 500);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}

const SEARCH_PROPERTIES = [
  "hs_object_id",
  "dealname",
  "amount",
  "dealstage",
  "pb_location",
  "address_line_1",
  "city",
  "state",
  "project_type",
  "hubspot_owner_id",
  "site_survey_schedule_date",
  "site_survey_status",
];

const SALES_STAGE_MAP = STAGE_MAPS.sales || {};

export async function GET(request: NextRequest) {
  const authError = await requireApiAuth(request);
  if (authError) return authError;

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ deals: [], message: "Query must be at least 2 characters" });
  }

  const portalId = process.env.HUBSPOT_PORTAL_ID || "21710069";

  try {
    // HubSpot search API doesn't support pipeline="default" as a filter.
    // Search by active sales stage IDs using OR filter groups, with text query.
    const activeStageIds = Object.keys(SALES_STAGE_MAP).filter(
      (id) => !["closedwon", "closedlost"].includes(id)
    );

    // Build filterGroups: one per stage (OR logic), each with the stage filter
    const filterGroups = activeStageIds.map((stageId) => ({
      filters: [
        { propertyName: "dealstage", operator: FilterOperatorEnum.Eq, value: stageId },
      ],
    }));

    const response = await searchWithRetry({
      query: q,
      filterGroups,
      properties: SEARCH_PROPERTIES,
      limit: 20,
    });

    const deals = (response.results || []).map((deal) => {
      const props = deal.properties || {};
      const stageId = props.dealstage || "";
      return {
        id: props.hs_object_id || deal.id,
        name: props.dealname || "Unknown",
        amount: Number(props.amount) || 0,
        stage: SALES_STAGE_MAP[stageId] || stageId,
        location: props.pb_location || "Unknown",
        address: [props.address_line_1, props.city, props.state].filter(Boolean).join(", ") || "",
        city: props.city || "",
        state: props.state || "",
        type: props.project_type || "Solar",
        surveyDate: props.site_survey_schedule_date || null,
        surveyStatus: props.site_survey_status || null,
        url: `https://app.hubspot.com/contacts/${portalId}/record/0-3/${props.hs_object_id || deal.id}`,
      };
    });

    return NextResponse.json({ deals });
  } catch (error) {
    console.error("[Deals Search] Error:", error);
    return NextResponse.json({ error: "Failed to search deals" }, { status: 500 });
  }
}
```

**Step 2: Test the API route manually**

Run: `npm run dev`
Test: `curl "http://localhost:3000/api/deals/search?q=smith"` (or any known deal name)
Expected: JSON with `{ deals: [...] }` containing Sales Pipeline deals

**Step 3: Commit**

```bash
git add src/app/api/deals/search/route.ts
git commit -m "feat: add /api/deals/search endpoint for Sales Pipeline deal lookup"
```

---

### Task 2: Add Pre-Sale Toggle and Search UI to Site Survey Scheduler

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx`

This task adds the tab toggle and search box. It does NOT change the scheduling logic yet — that's Task 3.

**Step 1: Add state variables for pre-sale mode**

After the existing state declarations around line 330-360, add:

```typescript
/* ---- pre-sale mode ---- */
const [surveyMode, setSurveyMode] = useState<"ops" | "pre-sale">("ops");
const [preSaleSearch, setPreSaleSearch] = useState("");
const [preSaleResults, setPreSaleResults] = useState<SurveyProject[]>([]);
const [preSaleSearching, setPreSaleSearching] = useState(false);
const [selectedPreSaleDeal, setSelectedPreSaleDeal] = useState<SurveyProject | null>(null);
```

**Step 2: Add the search function**

Add a debounced search effect that calls `/api/deals/search`:

```typescript
// Pre-sale deal search with debounce
useEffect(() => {
  if (surveyMode !== "pre-sale" || preSaleSearch.length < 2) {
    setPreSaleResults([]);
    return;
  }
  const timer = setTimeout(async () => {
    setPreSaleSearching(true);
    try {
      const res = await fetch(`/api/deals/search?q=${encodeURIComponent(preSaleSearch)}`);
      if (res.ok) {
        const data = await res.json();
        setPreSaleResults(
          (data.deals || []).map((d: {
            id: string; name: string; address: string; location: string;
            amount: number; type: string; stage: string; surveyDate: string | null;
            surveyStatus: string | null; url: string; city: string; state: string;
          }) => ({
            id: String(d.id),
            name: d.name,
            address: d.address || "Address TBD",
            location: d.location || "Unknown",
            amount: d.amount || 0,
            type: d.type || "Solar",
            systemSize: 0,
            batteries: 0,
            evCount: 0,
            scheduleDate: d.surveyDate || null,
            surveyStatus: d.surveyStatus || "Ready to Schedule",
            completionDate: null,
            closeDate: null,
            hubspotUrl: d.url,
            dealOwner: "",
            isPreSale: true,
          } satisfies SurveyProject))
        );
      }
    } catch {
      setPreSaleResults([]);
    } finally {
      setPreSaleSearching(false);
    }
  }, 300);
  return () => clearTimeout(timer);
}, [surveyMode, preSaleSearch]);
```

**Step 3: Add `isPreSale` field to `SurveyProject` interface**

At `src/app/dashboards/site-survey-scheduler/page.tsx:40-65`, add to the `SurveyProject` interface:

```typescript
isPreSale?: boolean; // true for Sales Pipeline deals (pre-sale surveys)
```

**Step 4: Add the toggle UI above the sidebar**

Replace the sidebar header at line ~1810 (the `<div className="p-3 border-b ...">` block) with a toggle + conditional content:

```tsx
<div className="p-3 border-b border-t-border bg-surface/50">
  {/* Mode toggle */}
  <div className="flex rounded-lg bg-surface-2 p-0.5 mb-2">
    <button
      onClick={() => { setSurveyMode("ops"); setSelectedPreSaleDeal(null); }}
      className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
        surveyMode === "ops"
          ? "bg-cyan-600 text-white shadow-sm"
          : "text-muted hover:text-foreground"
      }`}
    >
      Ops Surveys
    </button>
    <button
      onClick={() => { setSurveyMode("pre-sale"); setSelectedProject(null); }}
      className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
        surveyMode === "pre-sale"
          ? "bg-orange-600 text-white shadow-sm"
          : "text-muted hover:text-foreground"
      }`}
    >
      Pre-Sale
    </button>
  </div>

  {surveyMode === "ops" ? (
    <>
      <h2 className="text-sm font-semibold text-cyan-400">
        Ready to Schedule ({unscheduledProjects.length})
      </h2>
      <p className="text-xs text-muted mt-1 hidden sm:block">
        Drag to calendar or click to select
      </p>
    </>
  ) : (
    <>
      <h2 className="text-sm font-semibold text-orange-400">
        Pre-Sale Survey
      </h2>
      <input
        type="text"
        value={preSaleSearch}
        onChange={(e) => setPreSaleSearch(e.target.value)}
        placeholder="Search by name or address..."
        className="mt-2 w-full px-3 py-1.5 text-sm bg-surface-2 border border-t-border rounded-lg text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-orange-500"
      />
    </>
  )}
</div>
```

**Step 5: Render pre-sale search results in the sidebar content area**

Replace the sidebar scrollable content (line ~1818, the `<div className="max-h-[40vh]...">` block). Wrap it in a conditional:

```tsx
<div className="max-h-[40vh] lg:max-h-[calc(100vh-280px)] overflow-y-auto">
  {surveyMode === "ops" ? (
    /* existing unscheduledProjects.map(...) content — keep as-is */
  ) : (
    /* Pre-sale search results */
    preSaleSearching ? (
      <div className="p-4 text-center text-muted text-sm">Searching...</div>
    ) : preSaleSearch.length < 2 ? (
      <div className="p-4 text-center text-muted text-sm">
        Type at least 2 characters to search
      </div>
    ) : preSaleResults.length === 0 ? (
      <div className="p-4 text-center text-muted text-sm">
        No deals found
      </div>
    ) : (
      preSaleResults.map((deal) => (
        <div
          key={deal.id}
          onClick={() => {
            setSelectedPreSaleDeal(selectedPreSaleDeal?.id === deal.id ? null : deal);
            setSelectedProject(selectedPreSaleDeal?.id === deal.id ? null : deal);
          }}
          className={`p-3 border-b border-t-border cursor-pointer hover:bg-skeleton transition-colors ${
            selectedPreSaleDeal?.id === deal.id ? "bg-orange-900/20 border-l-2 border-l-orange-500" : ""
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium text-foreground truncate">{deal.name}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30 font-medium shrink-0">
                  Pre-Sale
                </span>
              </div>
              <p className="text-xs text-muted truncate mt-0.5">{deal.address}</p>
              <p className="text-xs text-muted truncate mt-0.5">{deal.location}</p>
            </div>
            <span className="text-xs font-mono text-orange-400 ml-2">
              {formatCurrency(deal.amount)}
            </span>
          </div>
        </div>
      ))
    )
  )}
</div>
```

**Step 6: Test the toggle and search UI**

Run: `npm run dev`, navigate to `/dashboards/site-survey-scheduler`
Expected: Toggle between "Ops Surveys" and "Pre-Sale" tabs. Search box appears in pre-sale mode. Typing a deal name shows results from the Sales Pipeline.

**Step 7: Commit**

```bash
git add src/app/dashboards/site-survey-scheduler/page.tsx
git commit -m "feat: add pre-sale survey toggle and search UI to survey scheduler"
```

---

### Task 3: Wire Pre-Sale Scheduling to Create Zuper Jobs

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx` (confirmSchedule function, ~line 981)

**Step 1: Pass `rescheduleOnly: false` for pre-sale surveys**

In the `confirmSchedule` function (~line 981), modify the fetch body to set `rescheduleOnly` based on whether this is a pre-sale deal. Find the line `rescheduleOnly: true` (~line 1087) and change it:

```typescript
rescheduleOnly: !selectedPreSaleDeal, // false for pre-sale (create new Zuper job), true for ops (reschedule existing)
```

**Step 2: Use `"pre-sale-survey"` schedule type for ScheduleRecord**

In the same `confirmSchedule` function, find where `schedule.type` is set to `"survey"` and add a conditional `scheduleType` field to the request body, or adjust the `notes` field to include a `[PRE_SALE]` tag so the ScheduleRecord can distinguish:

Add to the schedule object in the request body:
```typescript
notes: selectedPreSaleDeal
  ? `[PRE_SALE] Surveyor: ${slot?.userName || effectiveAssignee} at ${slot?.startTime || "N/A"}`
  : (slot ? `Surveyor: ${slot.userName} at ${slot.startTime}` : "Scheduled via Site Survey Scheduler"),
```

**Step 3: Handle the "no_job_found" response gracefully for pre-sale**

Currently when `data.action === "no_job_found"` (~line 1095), a warning toast is shown. For pre-sale surveys, this shouldn't happen since `rescheduleOnly: false` will create a new job. But if it does fail for another reason, the existing error handling already covers it. No change needed here.

**Step 4: Clear pre-sale state after successful scheduling**

After a successful schedule confirmation (in the success handler), add:
```typescript
if (selectedPreSaleDeal) {
  setSelectedPreSaleDeal(null);
  setPreSaleSearch("");
  setPreSaleResults([]);
}
```

**Step 5: Test end-to-end**

Run: `npm run dev`
1. Switch to "Pre-Sale" tab
2. Search for a Sales Pipeline deal
3. Select it, click a date on the calendar
4. Pick a surveyor, pick a time slot
5. Confirm

Expected:
- Zuper job is created (check Zuper dashboard)
- HubSpot `site_survey_schedule_date` is updated on the deal
- ScheduleRecord written to DB
- Toast shows success
- Pre-sale selection is cleared

**Step 6: Commit**

```bash
git add src/app/dashboards/site-survey-scheduler/page.tsx
git commit -m "feat: wire pre-sale surveys to create Zuper jobs with HubSpot write-back"
```

---

### Task 4: Final Polish and Edge Cases

**Files:**
- Modify: `src/app/dashboards/site-survey-scheduler/page.tsx`

**Step 1: Reset mode-specific state when switching tabs**

Ensure switching from pre-sale back to ops clears pre-sale state, and vice versa. In the toggle button handlers:

```typescript
// Ops button
onClick={() => {
  setSurveyMode("ops");
  setSelectedPreSaleDeal(null);
  setPreSaleSearch("");
  setPreSaleResults([]);
}}

// Pre-Sale button
onClick={() => {
  setSurveyMode("pre-sale");
  setSelectedProject(null);
}}
```

**Step 2: Show pre-sale badge on calendar events**

When a pre-sale survey is confirmed, it will appear on the calendar the same as ops surveys (via the ScheduleRecord). If a future page reload renders it, the `[PRE_SALE]` tag in the notes field can be used to style it differently. For now, the notes tag is sufficient — no extra work needed.

**Step 3: Verify the page builds**

Run: `npx next build`
Expected: Clean build with no type errors

**Step 4: Final commit**

```bash
git add src/app/dashboards/site-survey-scheduler/page.tsx
git commit -m "feat: polish pre-sale survey mode — state resets and edge cases"
```
