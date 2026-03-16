# BOM Matching Staging Review

PR: #89
Environment: Staging
Reviewer:
Review window:
Branch / commit:

## Goals

- Confirm shared search-term generation did not regress PB-standard matching
- Validate alias-normalized models match the expected Zoho item
- Identify real miss patterns before adding more heuristics
- Watch for false positives, not just unmatched items

## Sample Set

| BOM / Project | Job Type | Why Included | Expected Risk |
|---|---|---|---|
|  |  | PB-standard baseline | Low |
|  |  | PB-standard baseline | Low |
|  |  | PB-standard baseline | Low |
|  |  | Newer panel/inverter brand | Medium |
|  |  | Newer panel/inverter brand | Medium |
|  |  | Alias/suffix variant | Medium |
|  |  | Alias/suffix variant | Medium |
|  |  | Messy planset / sparse descriptions | High |
|  |  | Messy planset / sparse descriptions | High |

## BOM-Level Results

| BOM / Project | Total Items | Auto-Matched | Unmatched | Suspected Wrong Matches | Overall Outcome | Notes |
|---|---:|---:|---:|---:|---|---|
|  |  |  |  |  | Pass / Mixed / Fail |  |
|  |  |  |  |  | Pass / Mixed / Fail |  |
|  |  |  |  |  | Pass / Mixed / Fail |  |
|  |  |  |  |  | Pass / Mixed / Fail |  |

## Item Review Log

| BOM / Project | Category | BOM Brand | BOM Model | BOM Description | Search Terms Attempted | Expected Zoho Item | Actual Result | Root Cause Bucket | Recommended Fix | Confidence |
|---|---|---|---|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |  | Missing brand inference / Missing model alias rule / Search-term ordering issue / Extraction issue / Zoho catalog gap / Wrong match / Human review needed |  | High / Med / Low |
|  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |
|  |  |  |  |  |  |  |  |  |  |  |

## False Positive Checks

| BOM / Project | BOM Item | Matched Zoho Item | Why It Looks Wrong | Severity | Action Needed |
|---|---|---|---|---|---|
|  |  |  |  | High / Med / Low |  |
|  |  |  |  |  |  |

## Pattern Summary

### What matched better than before

-
-
-

### What still missed

-
-
-

### Repeated miss pattern

-
-
-

## Decision

- [ ] No follow-up needed
- [ ] Add brand inference rule(s)
- [ ] Add model alias rule(s)
- [ ] Tune search-term ordering
- [ ] Tighten description fallback
- [ ] Improve BOM extraction prompt
- [ ] Backfill / fix Zoho catalog data
- [ ] Other:

## Recommended Next Changes

1.
2.
3.

## Final Notes

- Standard PB jobs regressed? Yes / No
- Alias normalization helped? Yes / No
- Any new false positives? Yes / No
- Confidence in shipping current matcher: High / Med / Low
