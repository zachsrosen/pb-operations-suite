# EagleView Go-Live Demo — Recording Script

**Length target:** 5–7 minutes
**Tool:** Loom (or QuickTime + manual upload)
**Demo deal:** PROJ-9750 — Jess Smith — 8256 Park Rd, survey scheduled for 2026-04-29

> **Tip:** Have these tabs pre-loaded in this order before hitting Record. Switch Cmd+Shift+] to advance. Speak naturally — bullet points are talking notes, not a script.

---

## [0:00–0:30] Intro + use case

> *Tab: Deal review page — `https://www.pbtechops.com/dashboards/reviews/59382535039`*

"Hi, this is Zach Rosen at Photon Brothers. I'm walking through the EagleView TrueDesign integration we built — it's ready for production go-live and I wanted to show you what we've got running against your sandbox.

The business problem: our designers manually order a TrueDesign for Planning report through your web UI for every solar deal, and our surveyors arrive at job sites without those files prepped. We built an automated pipeline so that, the day before a scheduled site survey, our system places a TDP order against your Measurement Orders API and drops the deliverables in the deal's Drive folder before the surveyor leaves."

## [0:30–1:00] Show the deal context

> *Same tab — point at the EagleView panel on the deal review page*

"Here's a real solar deal in our HubSpot — Jess Smith at 8256 Park Rd. Site survey scheduled for the 29th. You can see we render an EagleView panel right on the deal — it shows whether we've ordered TDP for this address yet, and surfaces a manual order button as an escape hatch for late-scheduled surveys."

## [1:00–2:30] Live API call against sandbox

> *Open Chrome DevTools → Network tab → click "Pull EagleView Files" button*

"I'll click the manual order button now. Watch the network tab.

[click button]

You can see the OAuth2 client credentials handshake hitting `apicenter.eagleview.com/oauth2/v1/token`, then `SolarProductAvailability` against the sandbox base URL, then `PlaceOrder` for product ID 91 — TrueDesign for Planning.

The response gives us a ReportId from your sandbox, and we persist that as an `EagleViewOrder` row in our database with status ORDERED. That's the durable handle for everything downstream — status polling, file retrieval, idempotency.

[show DB row in admin / postgres GUI]"

## [2:30–4:00] HubSpot workflow

> *Switch to: `https://app.hubspot.com/workflows/21710069/platform/flow/1810800163/edit`*

"This is the HubSpot side — the workflow that triggers automated orders.

[scroll through the workflow]

Trigger: deal-based, enrolls when project type contains 'Solar' AND a site survey date is set.

Delay: until the day before the survey at 4 AM Mountain Time.

Action: webhook POST to our endpoint, with the HubSpot v3 signature header so we can verify the call really came from this workflow.

Currently set to OFF — we'll flip it on the moment production access is approved.

For the day-before-survey window, that's roughly 30 to 50 TDP orders per week starting out, scaling to about 150 per week as we roll out across all five Photon Brothers offices."

## [4:00–5:30] Code tour (optional, can skip if running long)

> *Switch to: `lib/eagleview.ts` in editor or GitHub*

"Quick code tour. Our client lives at `lib/eagleview.ts` — class-based, follows the pattern of our other vendor integrations.

[show key parts]

Token caching with auto-refresh on 401. Exponential backoff retries on 429 and 5xx. Sentry breadcrumbs for observability.

One nuance worth flagging — your OpenAPI spec describes the request bodies in PascalCase, but the actual API requires camelCase. We hit a generic 'latitude must be between 16 and 70' error initially with PascalCase fields. Worth fixing in your docs to save the next integrator time.

Test coverage is 33 unit tests passing on the client + the orchestrator pipeline."

## [5:30–6:30] Webhook receiver + scale

> *Switch to: `/api/webhooks/eagleview/file-delivery/route.ts` in editor*

"For order completion, we have your `FileDelivery` push set up at `https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`. HMAC-validated. When you push file URLs to us, we fetch + drop everything in the deal's Drive folder, mark the order DELIVERED, and notify our team.

A 30-minute cron poller acts as a safety net for missed webhooks.

For idempotency we key on `(dealId, productCode, addressHash)` so we never double-order an address."

## [6:30–7:00] Wrap-up

> *Back to deal review page or close on a clean slide*

"That's the integration. Everything's running clean against your sandbox today — the only thing standing between us and live order automation is your production access.

The webhook URL we'd want allowlisted for FileDelivery push: `https://www.pbtechops.com/api/webhooks/eagleview/file-delivery`. I'll send the bearer secret separately once we get the green light.

Happy to answer any questions over email or hop on a quick call if anything needs more depth. Looking forward to going live.

Thanks!"

---

## Pre-record checklist

- [ ] Test the manual button on PROJ-9750 once before recording (verify it works, no errors)
- [ ] Clear DevTools network tab so the "during recording" capture is clean
- [ ] Close noisy browser tabs / Slack / Discord notifications
- [ ] Switch to a clean Chrome profile if your normal one has lots of bookmarks/extensions visible
- [ ] DB UI ready — Postgres or Prisma Studio with `EagleViewOrder` table queried
- [ ] Editor with `src/lib/eagleview.ts` open and scrolled to the OAuth section

## Backup answers — if they email follow-up questions

| Q | A |
|---|---|
| Rate-limit handling? | Exponential backoff, 3 retries max, 429/5xx only. Immediate fail on 4xx. |
| Idempotency? | `(dealId, productCode, addressHash)` unique constraint in Postgres. Re-runs are no-ops. |
| Failure surfaces? | Sentry alerts + an admin email on terminal failures. `EagleViewOrder.status=FAILED` row with `errorMessage` for ops to retry. |
| Webhook security? | HubSpot v3 signature on inbound from HubSpot. HMAC-SHA256 on inbound from EV (we'll match whatever you push). |
| Test coverage? | 33 unit tests on the client, pipeline orchestrator, dedup helpers. CI runs them on every PR. |
| Volume + scale? | 30–50 TDP/week initially, scaling to ~150/week across 5 offices. |
| Cost controls? | Daily summary email per office. Manual order requires an OPS_MANAGER+ role. Address dedup prevents accidental double-orders. |
| Why did you create a sandbox app first? | Standard build pattern — wanted to verify auth + API shape against your sandbox before requesting production. |

## After-recording

1. Loom auto-generates a shareable link
2. Reply to the EV reviewer with: "Here's a recorded walkthrough so you can review on your schedule: [loom link]. Happy to hop on a live call too if you want to dig into anything."
3. Mention you're available for follow-up calls but the recording covers the full flow

## What NOT to demo

- Production credentials (we'd be ordering real reports)
- Actually placing orders that deliver real files (sandbox is fine for showing the call shape)
- Internal HubSpot data beyond the demo deal (privacy)
