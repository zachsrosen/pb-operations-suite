# OpenSolar API Discovery — Pre-Phase for Chunk 6 Sync

**Blocks:** enabling `ADDER_SYNC_ENABLED=true` in production.

Fill in the answers below before flipping the kill switch.

## 1. Lockdown capability

**Question:** Can the OpenSolar account be configured so reps cannot create free-form adder line items on deals?

**Why it matters:** If no, the whole spec's value drops — the governed catalog is advisory, not enforceable. Ops can audit and coach, but won't catch misuse at the source.

**Decision gate:** if unsupported, publish a monthly line-item audit instead and document as a known limitation.

**Answer:** [ ]

## 2. Per-shop pricing on a single adder

**Question:** Does an OpenSolar adder support per-shop pricing on a single record (e.g., base price + Westminster override + DTC override), or must we push N separate adders?

**Why it matters:** Current VALID_SHOPS has 5 entries. N-per-adder means 5× catalog size in OpenSolar.

**Answer:** [ ]

## 3. Retire/archive flag

**Question:** Does OpenSolar support an `archived` or `active: false` flag on adders, or do we have to delete + recreate on reactivation?

**Answer:** [ ]

## 4. API write surface + rate limits

**Question:** What are the exact REST endpoints for:
- create adder
- update adder
- retire / archive adder
- list adders

Include rate limits and any idempotency-key support.

**Answer:** [ ]

## 5. Auth mechanism

**Question:** Personal access token? OAuth? What env vars does the team already use for OpenSolar integration (if any)?

**Answer:** [ ]

## 6. Sandbox / staging

**Question:** Is there an OpenSolar sandbox account to test sync against before touching production?

**Answer:** [ ]

---

Once answered, update `src/lib/adders/opensolar-client.ts` with the real endpoints and flip `ADDER_SYNC_ENABLED=true` in staging for verification.
