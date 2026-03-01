# Product Lookup Skill — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a Claude Code skill with curated manufacturer reference files that answers product spec, installation quantity, and compatibility questions for PB solar equipment.

**Architecture:** Flat markdown reference files in `.claude/skills/product-lookup/references/`, one per manufacturer. Skill.md defines trigger patterns and workflow (check references first, web fallback second). No API endpoints or database changes needed.

**Tech Stack:** Claude Code skills (markdown), WebSearch/WebFetch for live fallback

---

### Task 1: Create Skill Scaffold

**Files:**
- Create: `.claude/skills/product-lookup/SKILL.md`

**Step 1: Write the skill.md file**

Create the skill file with frontmatter, trigger patterns, workflow, and manufacturer index:

```markdown
---
name: product-lookup
description: This skill should be used when Claude needs to look up solar equipment product details — installation quantities, specifications, sizing rules, compatibility charts, or selection guidance. Triggered by questions like "how many snow dogs per array?", "what clamp for this module frame?", "XR10 vs XR100?", "PW3 expansion kit contents", or any time during BOM extraction or SO creation when product-level knowledge is needed to make a decision.
version: 0.1.0
---

# Product Lookup Skill

Answer product specification, installation quantity, and compatibility questions for PB solar/storage equipment using curated manufacturer reference files.

## When to Use

- During BOM extraction: verify quantities, select correct SKUs
- During SO creation/comparison: validate post-processor rules
- When user asks product questions: specs, sizing, compatibility
- When investigating quantity discrepancies between auto and ops SOs

## Workflow

1. **Parse the query** — identify which manufacturer(s) and product(s) are relevant
2. **Read reference file(s)** — load from `references/` directory below
3. **Answer from reference** — if covered, answer with specific data and source
4. **Web fallback** — if reference is insufficient:
   - WebSearch: `[manufacturer] [product] installation guide specifications`
   - WebFetch: manufacturer's official page or spec sheet
5. **Flag gaps** — if web fallback was needed, note what should be added to reference files

## Manufacturer Reference Index

| File | Manufacturer | Products Covered |
|------|-------------|-----------------|
| `references/ironridge.md` | IronRidge | XR10, XR100 rails; HUG attachment; UFO mid clamp; CAMO end clamp; BOSS bonded splice; lag screws; ground lugs |
| `references/tesla.md` | Tesla | Powerwall 3; Gateway-3; MCI-2 rapid shutdown; expansion kit; backup switch; wall mount kit |
| `references/alpine.md` | Alpine Snow Guards | Snow Dog (BLK/CLR); qty rules; mounting; pitch limits |
| `references/imo.md` | IMO | SI16-PEL64R-2 rapid shutdown switch; comm wire |
| `references/seg-solar.md` | SEG Solar | SEG-440-BTD-BG module; frame dims; clamp range |
| `references/hyundai-solar.md` | Hyundai Solar | HiN-T440NF(BK) module; frame dims; clamp range |
| `references/ez-solar.md` | EZ Solar | JB-1.2 junction box |
| `references/s5.md` | S-5! | ProteaBracket; standing seam clamps |
| `references/enphase.md` | Enphase | IQ8 series; trunk cable; Q relay |

## Reference File Format

Each file follows this structure:

### [Product Name]
- **Model/SKU:** [part number]
- **Category:** [BOM category]

#### Specifications
| Spec | Value |
|------|-------|
| ... | ... |

#### Installation Rules
- Qty formula: [how to calculate]
- Compatibility: [what it works with]
- Constraints: [limitations]

#### Sizing Guide
[When to use this vs alternatives]
```

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/SKILL.md
git commit -m "feat: scaffold product-lookup skill with trigger patterns and workflow"
```

---

### Task 2: Alpine Snow Guards Reference

**Files:**
- Create: `.claude/skills/product-lookup/references/alpine.md`

**Step 1: Research and write the reference file**

Source: [Alpine Snow Guards - Snow Dog](https://slateroofwarehouse.com/snow-dog), [Alpine Installation Instructions](https://www.alpinesnowguards.com/product-installation-instructions)

Key facts already gathered from web research:
- Snow Dog SKU: SGSNOWDOG-BLK (black), SGSNOWDOG-CLR (clear)
- Qty per module: **2 per module (portrait orientation), 3 per module (landscape)**
- Installed between panels in horizontal joints, min 3/8" gap
- Weight: 0.5 lbs each
- Material: Anodized aluminum
- Price: ~$14/unit

**IMPORTANT:** The manufacturer spec (2 per module) does NOT match PB ops practice. From real SO data:
- Turner PROJ-9015: 27 modules → 10 snow dogs (ops), not 54
- Wang PROJ-9009: 12 modules → 8 snow dogs (ops), not 24

The reference file should document BOTH the manufacturer spec AND the observed PB ops pattern. Flag this as an open question — the ops team may use a different rule (e.g., bottom row only, or per-array-edge).

Write the file with all specs, the manufacturer qty formula, the PB ops observed pattern, and a clear note that the ops formula needs verification with the ops team.

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/references/alpine.md
git commit -m "feat: add Alpine Snow Guards reference (snow dog specs + qty rules)"
```

---

### Task 3: IronRidge Reference

**Files:**
- Create: `.claude/skills/product-lookup/references/ironridge.md`

**Step 1: Research and write the reference file**

Sources:
- [IronRidge XR Flush Mount Manual (PDF)](https://files.ironridge.com/pitched-roof-mounting/resources/brochures/IronRidge_Flush_Mount_Installation_Manual.pdf)
- [IronRidge Pitched Roof Design Guide](https://files.ironridge.com/pitched-roof-mounting/resources/brochures/Pitched_Roof_Design_Guide.pdf)
- [Solaris IronRidge Guide](https://www.solaris-shop.com/blog/ironridge-racking-the-complete-guide/)

Key specs already gathered:
- **XR10:** Snow load 0-30 PSF, wind 160 MPH, span 4'-6', 6000-series aluminum anodized
- **XR100:** Snow load 0-70 PSF, wind 160 MPH, span 4'-8'
- **Rail lengths:** 168" (14 ft) standard — confirm from IronRidge catalog
- **UFO mid clamp:** Universal single-piece, compatible with wide range of module depths
- **CAMO end clamp:** Compatible with multiple module dimensions
- **BOSS bonded splice:** Self-drilling screws, no assembly
- **HUG attachment:** Halo UltraGrip for composition shingle roofs

For each product, document:
- Part numbers / SKU patterns (XR-10-168T, UFO-CL-XX, etc.)
- When to use XR10 vs XR100 (shingle vs metal roof, snow load)
- Qty formulas from PB ops SO data (HUG per module ratio, clamps per module, etc.)
- Structural screw specs (HW-RD1430-01-M1)

Use WebFetch on the IronRidge PDFs to fill in any gaps. If PDFs aren't fetchable, use the IronRidge parts catalog or design guide pages.

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/references/ironridge.md
git commit -m "feat: add IronRidge reference (XR rails, HUG, clamps, splices)"
```

---

### Task 4: Tesla Reference

**Files:**
- Create: `.claude/skills/product-lookup/references/tesla.md`

**Step 1: Research and write the reference file**

Sources:
- [Tesla Energy Library - PW3 Datasheet](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/Datasheet/en-us/Powerwall-3-Datasheet.pdf)
- [Tesla PW3 Required Supplies](https://energylibrary.tesla.com/docs/Public/EnergyStorage/Powerwall/3/InstallManual/Gateway/3/en-us/GUID-F796360B-AC23-4906-8F66-BAE1CC07B95E.html)
- [Greentech Renewables - PW3](https://www.greentechrenewables.com/product/tesla-powerwall-3-1707000-11-y)

Key specs already gathered:
- **Powerwall 3:** Part 1707000-xx-y, 13.5 kWh, LFP chemistry, up to 11.5 kW AC, up to 20 kW DC solar input
- **Part number variants:** 1707000-11-Y (older), 1707000-21-K (current in PB plansets)
- **Conduit rule:** 1707000-11-L and higher or 1707000-21-L and higher → metallic or non-metallic; all others → metallic only
- **Gateway-3:** Part 1841000-x1-y, 200A, NEMA 3R
- **MCI-2:** Module-level rapid shutdown, qty = modules/2 rounded up
- **Expansion kit:** Part 1807000-20-B
- **Backup switch:** Part 1624171-00-x

Document all part numbers, when each is used, and what accessories come with each (wall mount, stacking kit, etc.).

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/references/tesla.md
git commit -m "feat: add Tesla reference (PW3, Gateway-3, MCI-2, expansion kit)"
```

---

### Task 5: IMO Reference

**Files:**
- Create: `.claude/skills/product-lookup/references/imo.md`

**Step 1: Write the reference file**

This is a small file — one product. Most info is already in the planset-bom skill:
- **Model:** SI16-PEL64R-2
- **Category:** RAPID_SHUTDOWN (control unit)
- **Function:** Triggers MCI-2 module-level devices
- **Qty:** Always 1 per job
- **Wiring:** 16/2 comm wire to MCI-2 devices
- **Source:** Only appears on PV-4 SLD, NOT in PV-2 BOM table

Use WebSearch to find any additional specs (dimensions, weight, certifications).

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/references/imo.md
git commit -m "feat: add IMO reference (SI16-PEL64R-2 rapid shutdown switch)"
```

---

### Task 6: Module References (SEG Solar + Hyundai)

**Files:**
- Create: `.claude/skills/product-lookup/references/seg-solar.md`
- Create: `.claude/skills/product-lookup/references/hyundai-solar.md`

**Step 1: Research and write both reference files**

For each module, the critical specs are:
- Frame dimensions (width × height × depth in mm) — determines clamp selection
- Frame thickness — determines mid clamp (UFO) size
- Weight — for structural calculations
- Wattage, Voc, Isc, Vmp, Imp — for string sizing validation
- Connector type — MC4 compatibility

Sources:
- SEG Solar SEG-440-BTD-BG: search `SEG Solar SEG-440-BTD-BG datasheet specifications`
- Hyundai Solar HiN-T440NF(BK): search `Hyundai Solar HiN-T440NF datasheet specifications`

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/references/seg-solar.md .claude/skills/product-lookup/references/hyundai-solar.md
git commit -m "feat: add SEG Solar and Hyundai Solar module references"
```

---

### Task 7: Electrical References (EZ Solar + S-5! + Enphase)

**Files:**
- Create: `.claude/skills/product-lookup/references/ez-solar.md`
- Create: `.claude/skills/product-lookup/references/s5.md`
- Create: `.claude/skills/product-lookup/references/enphase.md`

**Step 1: Research and write all three reference files**

**EZ Solar JB-1.2:**
- Junction box for DC wire transition (PV-wire to THHN in conduit)
- Search for specs: dimensions, knockouts, cable entries, wire capacity

**S-5! ProteaBracket:**
- Metal roof attachment system (replaces HUG on trapezoidal metal roofs)
- Used with XR100 rails (not XR10)
- No lag screws needed
- Search for: compatible roof profiles, attachment spacing, load ratings

**Enphase IQ8 Series:**
- IQ8M, IQ8A, IQ8H microinverters
- Selection by module wattage
- Trunk cable (Q cable) lengths and connector types
- Q relay specs
- Different from Tesla string inverter approach — document key differences

**Step 2: Commit**

```bash
git add .claude/skills/product-lookup/references/ez-solar.md .claude/skills/product-lookup/references/s5.md .claude/skills/product-lookup/references/enphase.md
git commit -m "feat: add EZ Solar, S-5!, and Enphase references"
```

---

### Task 8: Verify Skill Triggers and Test

**Step 1: Verify skill is discoverable**

Check that the skill appears in Claude Code's skill list and triggers on expected queries.

**Step 2: Test with real questions**

Test the skill by asking:
- "How many snow dogs for a 16-module array?"
- "What clamp do I need for SEG-440 modules?"
- "XR10 or XR100 for a metal roof?"
- "What's in the PW3 expansion kit?"

Verify answers cite specific data from reference files.

**Step 3: Test web fallback**

Ask a question NOT covered in references (e.g., "What's the weight of an IronRidge ground mount rail?") and verify the skill falls back to web search.

**Step 4: Commit any fixes**

```bash
git add -A .claude/skills/product-lookup/
git commit -m "fix: product-lookup skill refinements from testing"
```

---

### Task 9: Revert Premature Post-Processor Changes

**Files:**
- Modify: `src/lib/bom-so-post-process.ts`

**Context:** In the previous session, the snow dog formula in the post-processor was changed to use `arrayCount * 2` before confirming that formula is correct. Now that we know:
- Manufacturer spec: 2 per module (portrait)
- PB ops practice: neither 2×modules nor 2×arrays matches real data
- The correct formula is still unknown

**Step 1: Revert the snow dog formula**

Change the snow dog section in Rule 3 back to the original bracket formula. Remove the `ctx.arrayCount` branch. Keep `arrayCount` in the types (BomProject, JobContext, detectJobContext) since that data is still useful — just don't use it in the formula yet.

**Step 2: Add a comment noting the open question**

```typescript
// Snow dogs — formula TBD
// Manufacturer spec: 2 per module (portrait), 3 per module (landscape)
// PB ops practice: unclear — Turner 27mod→10dogs, Wang 12mod→8dogs
// Neither 2×arrayCount nor 2×moduleCount matches. Needs ops team input.
// For now: use bracket formula from original v3 rules
```

**Step 3: Run build to verify**

```bash
npx next build
```

**Step 4: Commit**

```bash
git add src/lib/bom-so-post-process.ts
git commit -m "fix: revert snow dog formula to bracket-based (arrayCount formula unverified)"
```
