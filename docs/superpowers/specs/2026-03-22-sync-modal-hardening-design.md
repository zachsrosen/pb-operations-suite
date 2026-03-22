# Cross-System Sync Hardening & UX Polish

## Goal

Improve confidence and scanability around cross-system product creation/sync without adding a second editing model. Keep internal as the main source of truth, and add better previews, review surfaces, and UI clarity.

## Guiding Decision

Do not add generic write-in/custom cell editing for now. The default workflow stays:
- edit internal product data
- choose the source in SyncModal
- preview what each system will receive

If we later see strong demand for one-off external exceptions, we can revisit `custom` cell mode just for a few fields like `name`.

## Phase 1: Hardening

1. Clean up legacy `buildSkuName` usage in `src/lib/catalog-sync.ts` so all active preview/create paths use `sku.name` consistently.
2. Add integration tests proving create payloads honor pulled/relayed `name` values for Zoho, HubSpot, and Zuper.
3. Add UI tests for unlinked-column behavior in `src/components/catalog/SyncModal.tsx`:
   - visible `Create new` before search
   - toggle on/off behavior
   - link existing vs create new
4. Add a regression test for conflict prevention when relay sources are selected across multiple systems on the same internal field.

## Phase 2: SyncModal UX Polish

5. Add source chips next to projected values in edited cells, shown only for non-`keep` selections.
6. Add a sticky pending-actions summary above the Sync button, for example:
   - `2 updates to Zoho`
   - `1 relay from HubSpot to Zuper`
   - `1 create in Zuper`
7. Replace the unlinked-column header flow with an explicit `Link existing | Create new` mode switch.
8. Show disabled-option reasons in dropdowns for:
   - conflict prevention
   - same-value/no-op choices
   - unavailable source systems
9. Make divergence warnings more explicit than border color alone, especially when preserving custom external values.
10. Improve cached product search results with match context like exact SKU match, name match, and already-linked warnings.
11. Show linked external identity in the column header when available, such as product name/SKU.
12. Keep `Field` and `Internal` columns sticky while horizontally scrolling.

## Phase 3: Product Approval Window Preview

13. Add per-system preview cards to the product approval window, shown only for selected target systems.
14. For unlinked selected systems, show the exact create payload preview:
    - `name`
    - `sku`
    - `brand/manufacturer`
    - `model`
    - `description`
    - `category`
    - sell price / cost
    - vendor fields where relevant
15. For already-linked systems, show update preview instead of create preview.
16. Highlight missing, transformed, or system-specific values so users can catch issues before approving.
17. Reuse the same mapping/plan logic as SyncModal so the approval preview and actual execution stay aligned.

## Phase 4: Optional Earlier Preview

18. If the approval-window preview works well, consider echoing a lighter version on the final step of the Submit New Product flow.
19. Keep that version read-only and only show previews for systems the user selected to push/create.

## Phase 5: Verification

20. Create a live Vercel verification checklist covering:
    - linked product rendering
    - unlinked link/create flow
    - `name` pull/relay/create behavior
    - conflict prevention
    - approval-window create previews
    - final execution/results messaging

## Recommended Order

1. Phase 1 hardening
2. Phase 2 SyncModal UX polish
3. Phase 3 approval-window preview
4. Phase 4 only if still valuable after real usage
5. Phase 5 verification throughout, with final Vercel pass at the end

## Not Recommended Right Now

- generic freeform "write in" values inside SyncModal
- full editable create forms inside SyncModal
- reviving generator-specific UI concepts
