# Product Lookup Skill — Design Doc

**Date:** 2026-03-01
**Status:** Approved

## Problem

During BOM extraction and SO creation, Claude needs product-level knowledge — installation quantities, sizing rules, compatibility charts — that isn't available in the internal catalog or planset PDFs. Currently Zach has to manually verify things like snow dog quantities by checking plansets and manufacturer guides.

## Solution

A Claude Code skill with **curated manufacturer reference files** and a **live web fallback** for edge cases.

## Skill Structure

```
.claude/skills/product-lookup/
  skill.md                        # Trigger patterns, workflow, manufacturer index
  references/
    ironridge.md                  # Racking: XR10, XR100, HUG, clamps, splices, lag screws, ground lugs
    tesla.md                      # PW3, Gateway-3, MCI-2, expansion kit, backup switch, wall mount
    alpine.md                     # Snow dogs: models, sizing rules, qty formulas, mounting
    imo.md                        # SI16-PEL64R-2 rapid shutdown switch
    seg-solar.md                  # SEG-440-BTD-BG: frame dims, weight, clamp range
    hyundai-solar.md              # HiN-T440NF(BK): frame dims, weight, clamp range
    ez-solar.md                   # JB-1.2 junction box specs
    s5.md                         # ProteaBracket, metal roof attachments
    enphase.md                    # IQ8 series microinverters, trunk cable, Q relay
```

## Trigger Patterns

Skill is invoked when Claude needs to:
- Answer product spec questions ("How many snow dogs per array?", "What clamp for 30mm frame?")
- Verify BOM quantities during extraction
- Validate SKU selections during SO post-processing
- Compare auto vs ops SO quantities during analysis

## Workflow

1. **Parse query** — identify manufacturer(s) and product(s)
2. **Read reference file(s)** — load relevant markdown from `references/`
3. **Answer from reference** — if covered, answer directly with source citation
4. **Web fallback** — if insufficient, WebSearch manufacturer's site for spec sheets/install guides, then WebFetch to read
5. **Suggest reference update** — if web fallback found useful info, note it for future curation

## Reference File Format

Each file uses a consistent structure:

```markdown
# [Manufacturer] — Product Reference

## [Product Name]
- **Model/SKU:** [part number]
- **Category:** [BOM category]

### Specifications
| Spec | Value |
|------|-------|
| ... | ... |

### Installation Rules
- Qty formula: [how to calculate]
- Compatibility: [what it works with]
- Constraints: [limitations]

### Sizing Guide
[When to use this vs alternatives]
```

## Reference File Contents (Priority)

| File | Key Content |
|------|-------------|
| `ironridge.md` | Rail lengths + span tables, HUG qty formula, mid/end clamp frame-sizing chart, splice qty, lag screw qty, ground lug qty |
| `tesla.md` | PW3 part numbers by revision, Gateway-3 specs, MCI-2 vs MCI-2 HC selection, expansion kit contents, backup switch, wall mount vs floor |
| `alpine.md` | Snow dog models (BLK/CLR), **qty rules per array edge length or module count**, mounting pattern, pitch limits |
| `imo.md` | SI16-PEL64R-2 specs, 16/2 comm wire, always qty 1 |
| `seg-solar.md` | Frame width/height/thickness for clamp selection, weight, electrical specs |
| `hyundai-solar.md` | Frame dims for clamp selection, weight |
| `ez-solar.md` | JB-1.2 specs, use case (DC transition from PV-wire to THHN) |
| `s5.md` | ProteaBracket for trapezoidal metal, clamps for standing seam, no lag screws |
| `enphase.md` | IQ8 model selection by wattage, trunk cable lengths, Q relay specs |

## Integration with Other Skills

- **planset-bom**: Invoke product-lookup to verify extraction quantities
- **bom-to-so**: Use specs to validate post-processor SKU swaps and qty formulas
- **bom-so-analysis**: Look up specs to understand auto vs ops SO differences

## Approach

- **Flat reference files** (Approach A) — fast, reliable, no API costs
- Web fallback for uncommon products or when reference is insufficient
- No database or API endpoints needed — pure skill + markdown files

## Data Sources for Curation

Manufacturer websites for spec sheets and install guides:
- IronRidge: ironridge.com/resources
- Tesla: tesla.com/support/energy
- Alpine Snow Guards: alpinesnowguards.com
- IMO: imo.com
- SEG Solar: segsolar.com
- Hyundai Solar: hyundaisolar.com
- EZ Solar: ezsolarinc.com
- S-5!: s-5.com
- Enphase: enphase.com/installers
