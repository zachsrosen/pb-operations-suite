---
name: product-lookup
description: This skill should be used when Claude needs to look up solar equipment product details — installation quantities, specifications, sizing rules, compatibility charts, or selection guidance. Triggered by questions like "how many snow dogs per array?", "what clamp for this module frame?", "XR10 vs XR100?", "PW3 expansion kit contents", or any time during BOM extraction or SO creation when product-level knowledge is needed to make a decision.
version: 0.1.0
---

# Product Lookup Skill

Look up solar equipment specifications, installation quantities, sizing rules, and compatibility from curated manufacturer reference files.

## What This Skill Does

Answers product-level questions about solar and storage equipment used in Photon Brothers installations. Draws from curated manufacturer reference files for authoritative data, with web search fallback for products not yet documented.

## When to Use

- **BOM extraction** — determining correct quantities (e.g., snow dogs per array, MCI-2 per module)
- **SO creation** — selecting the right SKU variant for a roof type, panel brand, or inverter platform
- **User questions** — "what's the clamp range for UFO mid clamps?", "XR10 vs XR100 load capacity?"
- **SO analysis** — validating whether ops-created quantities follow manufacturer guidelines
- **Compatibility checks** — confirming module frame thickness fits a given clamp, or rail span limits

## Workflow

```
1. Parse query — identify manufacturer, product, and what info is needed
2. Read reference files — check the Manufacturer Reference Index below for the right file
3. Answer from reference — if the reference file covers it, answer directly with source citation
4. Web fallback — if references are insufficient, search manufacturer docs online
5. Flag gaps — if a product isn't in any reference file, note it for future addition
```

## Manufacturer Reference Index

| Reference File | Manufacturer | Products Covered |
|----------------|-------------|-----------------|
| `references/ironridge.md` | IronRidge | XR10, XR100 rails; HUG attachment; UFO mid clamp; CAMO end clamp; BOSS bonded splice; lag screws; ground lugs |
| `references/tesla.md` | Tesla | Powerwall 3; Gateway-3; MCI-2 rapid shutdown; expansion kit; backup switch; wall mount kit |
| `references/alpine.md` | Alpine Snow Guards | Snow Dog (BLK/CLR); qty rules; mounting; pitch limits |
| `references/imo.md` | IMO | SI16-PEL64R-2 rapid shutdown switch; comm wire |
| `references/seg-solar.md` | SEG Solar | SEG-440-BTD-BG module; frame dims; clamp range |
| `references/hyundai-solar.md` | Hyundai Solar | HiN-T440NF(BK) module; frame dims; clamp range |
| `references/ez-solar.md` | EZ Solar | JB-1.2 junction box |
| `references/s5.md` | S-5! | ProteaBracket; standing seam clamps |
| `references/enphase.md` | Enphase | IQ8 series; trunk cable; Q relay |

All reference files live in `.claude/skills/product-lookup/references/`.

## Reference File Format

Each reference file follows this structure:

```markdown
# [Manufacturer] — [Product Name]

## Product Info
- **Model / SKU:** [part number]
- **Category:** MODULE | BATTERY | RACKING | ELECTRICAL | ATTACHMENT

## Specifications
| Spec | Value |
|------|-------|
| ... | ... |

## Installation Rules
- Bullet list of installation quantity rules, spacing requirements, torque specs

## Sizing / Selection Guide
- How to choose the right variant based on roof type, module frame, span, etc.

## Compatibility
- What other products this works with (module frame ranges, rail types, inverter platforms)
```

## Web Fallback

When the reference files do not cover the product or spec needed:

1. **Search** using WebSearch: `[manufacturer] [product model] installation guide specifications site:[manufacturer domain]`
2. **Fetch** the top result using WebFetch to extract the specific data point
3. **Cite** the source URL in your answer
4. **Flag** the gap — note which product/spec should be added to a reference file for future use

Prefer manufacturer install guides and spec sheets over distributor listings.

## Integration

This skill supports three other skills in the BOM pipeline:

- **planset-bom** — call product-lookup during extraction when quantities depend on manufacturer rules (e.g., snow dog qty per array, MCI-2 per module count)
- **bom-to-so** — call product-lookup when the SO post-processor needs to select the correct SKU variant (e.g., which clamp for a given module frame thickness, rail length selection)
- **bom-so-analysis** — call product-lookup to validate whether ops-created quantities align with manufacturer installation guidelines
