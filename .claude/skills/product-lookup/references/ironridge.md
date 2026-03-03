# IronRidge Racking Products

Manufacturer: IronRidge, Inc.
Website: https://www.ironridge.com
Product line: XR Flush Mount System (pitched roof solar racking)

---

## Selection Guide: XR10 vs XR100

Decision tree for rail selection based on roof type and environmental loads:

```
Roof Type?
  |
  +-- Composition shingle (asphalt)
  |     |
  |     +-- Snow load 0-30 PSF --> XR10 + HUG attachments
  |     +-- Snow load 31-70 PSF --> XR100 + HUG attachments
  |
  +-- Trapezoidal standing-seam metal
  |     |
  |     +-- Any snow load --> XR100 + S-5! ProteaBracket (NOT IronRidge attachments)
  |
  +-- Tile (concrete/clay)
        |
        +-- Any snow load --> XR10 + tile hooks (third-party, not IronRidge)
```

**PB usage patterns (confirmed from SO data):**
- Asphalt shingle roofs: XR10 + HUG + RD structural screws (most common)
- Trapezoidal metal roofs: XR100 + S-5! ProteaBracket clamps (no IronRidge roof attachments)
- Tile roofs: XR10 + tile hooks (not an IronRidge product)
- XR100 is used when snow loads exceed XR10 capacity OR on metal roofs requiring longer spans

---

## XR10 Rail

Low-profile flush-mount rail for residential solar. Optimized for regions with light-to-moderate snow loads. Most common rail in PB installations.

### SKU Variants

| SKU | Length | Finish | Notes |
|-----|--------|--------|-------|
| XR-10-168T | 168" (14 ft) | Clear anodized | Standard PB rail |
| XR-10-168B | 168" (14 ft) | Black anodized | Aesthetic option |
| XR-10-084A | 84" (7 ft) | Clear anodized | Half-length |
| XR-10-084B | 84" (7 ft) | Black anodized | Half-length |

### Specifications

| Attribute | Value |
|-----------|-------|
| Material | 6000-series aluminum alloy, anodized |
| Max span | 6 ft (72") between attachments |
| Snow load | 0-30 PSF |
| Wind speed | Up to 160 MPH (Exposure B/C/D) |
| Standard length | 168" (14 ft) |
| Certification | UL 2703, ASCE 7-22 Risk Category II |
| Splice | Internal (BOSS bonded splice) |
| Finishes | Clear anodized (mill) and black anodized |

### Installation Rules

- Max span between roof attachments: 6 ft
- Rail overhang past last attachment must not exceed values in span table (typically 12-18")
- Use IronRidge Design Assistant for site-specific span tables based on wind exposure, roof zone, and slope
- Span tables cover roof slopes of 8 deg to 60 deg, wind exposures B/C/D
- Rails can be cut to length on-site; deburr cut ends

### Quantity Formula

```
Rails per row = ceil(total_row_length_inches / 168)
```

Where `total_row_length_inches` = (number_of_modules_in_row * module_width_inches) + clamp allowances.

---

## XR100 Rail

Heavy-duty flush-mount rail for residential and light commercial solar. Supports higher snow loads and longer spans than XR10. Used on metal roofs and high-snow regions.

### SKU Variants

| SKU | Length | Finish | Notes |
|-----|--------|--------|-------|
| XR-100-168A | 168" (14 ft) | Clear anodized | Standard |
| XR-100-168B | 168" (14 ft) | Black anodized | Aesthetic option |
| XR-100-084A | 84" (7 ft) | Clear anodized | Half-length |
| XR-100-084B | 84" (7 ft) | Black anodized | Half-length |

### Specifications

| Attribute | Value |
|-----------|-------|
| Material | 6000-series aluminum alloy, anodized |
| Max span | 8 ft (96") between attachments |
| Snow load | 0-70 PSF |
| Wind speed | Up to 160 MPH (Exposure B/C/D) |
| Standard length | 168" (14 ft) |
| Certification | UL 2703, ASCE 7-22 Risk Category II |
| Splice | Internal (BOSS bonded splice) |
| Finishes | Clear anodized (mill) and black anodized |

### Installation Rules

- Max span between roof attachments: 8 ft
- Same general installation rules as XR10
- Required for standing-seam metal roof installations (paired with S-5! clamps)
- Required when ground snow load exceeds 30 PSF

### Quantity Formula

Same as XR10:
```
Rails per row = ceil(total_row_length_inches / 168)
```

---

## QuickMount HUG (Halo UltraGrip) -- Roof Attachment

Flashless composition shingle roof attachment. Cast-aluminum halo with foam-and-mastic UltraGrip seal. Mounts to rafters, deck, or both using RD structural screws.

### SKU Variants

| SKU | Finish | Notes |
|-----|--------|-------|
| QM-HUG-01-M1 | Mill (clear) | Standard |
| QM-HUG-01-B1 | Black | Aesthetic option |
| 2101151 | Mill | PB SO catalog number |

### Specifications

| Attribute | Value |
|-----------|-------|
| Material | Cast aluminum halo + foam-and-mastic seal |
| Waterproofing | Multi-tiered: halo perimeter + UltraGrip mastic + EPDM washer on screw |
| Shingle step-down tolerance | Up to 1/8" height difference |
| Mounting options | Rafter, deck, or both |
| Fastener | RD structural screw (HW-RD1430-01-M1) |
| Certifications | UL 441 Rain Test, TAS 100(A) Wind Driven Rain Test, UL SUBJECT 2703A |
| Warranty | 25 years |

### Installation Rules

- One HUG per attachment point (one per rafter or deck location)
- Pair with RD structural screws (HW-RD1430-01-M1) -- one screw per HUG into rafter, additional screws into deck as needed
- Requires composition (asphalt) shingle roof -- NOT for tile or metal
- Foam-and-mastic seal conforms to shingle surface; no additional flashing needed
- T-bolt (BHW-TB-03-A1) connects HUG to XR rail

### Quantity Formula

```
HUGs per rail row = number_of_attachment_points_per_row
```

Attachment points determined by span table: typically every 4-6 ft for XR10, every 4-8 ft for XR100. Use IronRidge Design Assistant for exact spacing.

Typical residential: 1 HUG every 4-5 ft of rail = roughly 3-4 HUGs per 14 ft rail.

---

## RD Structural Screw

Custom-engineered rafter-or-deck screw that anchors HUG to the roof structure.

### SKU

| SKU | Description | Notes |
|-----|-------------|-------|
| HW-RD1430-01-M1 | RD Structural Screw, 3.0" | Standard; sold in boxes of 120 |

### Specifications

| Attribute | Value |
|-----------|-------|
| Material | 300 Series stainless steel |
| Length | 3.0 inches |
| Size | #14 with wood tip |
| Sealing | Integrated EPDM sealing washer |
| Finish | Clear |
| Application | Anchors HUG to rafter, deck, or both |

### Installation Rules

- One screw per HUG minimum (into rafter)
- Additional screws into deck sheathing as needed per engineering
- EPDM washer creates waterproof seal at penetration point
- Do not overtorque -- follow IronRidge torque specs

### Quantity Formula

```
Screws = HUGs * screws_per_HUG (typically 1 into rafter + additional per design)
```

Minimum 1 screw per HUG. Consult span tables for deck-only installations requiring multiple screws.

---

## UFO Mid Clamp (Universal Fastening Object)

Single-piece universal mid clamp that secures adjacent modules to XR rail. Provides integrated module grounding (UL 2703 listed bonding).

### SKU Variants

| SKU | Finish | Notes |
|-----|--------|-------|
| UFO-CL-01-A1 | Mill (clear) | Standard |
| UFO-CL-01-B1 | Black | Aesthetic option |

### Specifications

| Attribute | Value |
|-----------|-------|
| Compatible frame thickness | 30-46 mm |
| Material | Aluminum with bonding features |
| Torque | 80 in-lbs (7/16" socket) |
| Grounding | Integrated bonding -- listed to UL 2703 |
| Design | Single piece, pre-lubricated, low-profile |
| Warranty | 25 years |

### Installation Rules

- Sits between two adjacent modules on the same rail
- Torque to 80 in-lbs using 7/16" socket
- Hold clamp on end while torquing to prevent rotation
- Provides parallel grounding paths through both module frames and rail
- Compatible with nearly all framed modules (30-46 mm frame)

### Quantity Formula

```
Mid clamps per rail row = number_of_modules_in_row - 1
```

Each mid clamp secures the junction between two adjacent modules. A row of N modules needs (N-1) mid clamps.

---

## EFO / UFO End Clamp

End clamp that secures the outermost edge of end-of-row modules to XR rail. Uses stopper sleeves that snap onto UFO body.

### SKU Variants

| SKU | Finish | Frame Range | Notes |
|-----|--------|-------------|-------|
| UFO-END-01-A1 | Mill (clear) | 30-40 mm | Standard |
| UFO-END-01-B1 | Black | 30-40 mm | Aesthetic option |

### Specifications

| Attribute | Value |
|-----------|-------|
| Compatible frame thickness | 30-40 mm |
| Torque | 80 in-lbs (7/16" socket) |
| Grounding | Integrated bonding -- listed to UL 2703 |
| Warranty | 25 years |

**Note:** Narrower frame range than mid clamp (30-40 mm vs 30-46 mm). Verify module frame thickness before specifying.

### Installation Rules

- Two end clamps per rail row (one at each end)
- Same torque as mid clamp: 80 in-lbs
- Alternative: use CAMO hidden end clamp for cleaner appearance

### Quantity Formula

```
End clamps per rail row = 2
```

Always 2 per row (left end + right end), unless using CAMO hidden end clamps instead.

---

## CAMO Hidden End Clamp

Invisible end clamp that secures modules flush to rail ends for a clean, sleek appearance. Tool-free cam-locking mechanism -- rotate 90 deg to secure.

### SKU

| SKU | Finish | Notes |
|-----|--------|-------|
| CAMO-01-M1 | Mill (clear) | Sold in packs of 10 |
| CAMO-01-B1 | Black | Aesthetic option |

### Specifications

| Attribute | Value |
|-----------|-------|
| Compatible frame thickness | 33-40 mm (will NOT work on frames 32 mm or less) |
| Allowable design load | 50 PSF downward, 50 PSF upward, 15 PSF lateral |
| Installation | Tool-free; cam-lock rotation (90 deg) |
| Rail clearance required | 6" minimum from end of rail |
| Compatibility | Works with 99% of framed panels |
| Certification | UL 2703 |

### Installation Rules

- Requires 6" of clearance from end of rail
- Will NOT work with REC modules or any module with frame 32 mm or less
- No torque required -- cam-lock mechanism
- Can substitute for UFO-END end clamps for aesthetic preference
- Verify module frame is > 32 mm before specifying

### Quantity Formula

Same as end clamps:
```
CAMO per rail row = 2
```

---

## BOSS Bonded Structural Splice

Internal splice that joins two rails end-to-end. Self-bonding with built-in spring teeth -- no tools, screws, or assembly required.

### SKU Variants

| SKU | Compatible Rail | Notes |
|-----|-----------------|-------|
| XR10-BOSS-01-M1 | XR10 | Must match rail type |
| XR100-BOSS-01-M1 | XR100 | Must match rail type |
| XR1000-BOSS-01-M1 | XR1000 | For ground mount rail |

### Specifications

| Attribute | Value |
|-----------|-------|
| Material | Aluminum with bonding spring |
| Bonding | Built-in spring teeth bite into rail; meets UL standards |
| Assembly | None required -- insert and push until physical stop |
| Tools | None required |
| Expansion gap | 1" gap for runs over 100 ft of rail |
| Certification | UL 2703+ compliant integrated bonding |

### Installation Rules

- Insert splice into first rail until physical stop (centered)
- Slide second rail onto exposed end of splice
- Alignment circles on splice body indicate proper centering and 1" expansion gap position
- Can be installed on interior spans and end spans (no location restrictions)
- For continuous rail runs over 100 ft: leave 1" expansion gap between rails
- Match splice to rail type: XR10 splice for XR10 rail, XR100 splice for XR100 rail

### Quantity Formula

```
Splices per rail row = number_of_rails_in_row - 1
```

Only needed when a row requires more than one rail length (e.g., rows longer than 14 ft).

---

## T-Bolt Bonding Hardware

Connects roof attachments (HUG, L-feet) to XR rail channel. Slides into rail slot and twists to lock.

### SKU Variants

| SKU | Description | Notes |
|-----|-------------|-------|
| BHW-TB-02-A1 | T-bolt for L-foot attachment | Single bolt |
| BHW-TB-03-A1 | T-bolt for HUG/FlashFoot2 | Current standard for HUG |

### Specifications

| Attribute | Value |
|-----------|-------|
| Bolt size | 1/4" x 3/4" |
| Material | Stainless steel |
| Torque | 80 in-lbs |
| Socket size | 7/16" (same as UFO clamps) |
| Installation | Twist end to fit inside rail channel, slide to position |

### Quantity Formula

```
T-bolts = number_of_roof_attachments (1 per HUG or L-foot)
```

---

## Ground Lug

Connects equipment grounding conductor (EGC) to XR rail. One lug grounds an entire row of bonded modules.

### SKU Variants

| SKU | Material | Notes |
|-----|----------|-------|
| XR-LUG-04-A1 | Tin-plated aluminum | Current model |
| XR-LUG-03-A1 | Tin-plated aluminum | Discontinued; replaced by -04 |

### Specifications

| Attribute | Value |
|-----------|-------|
| Material | Tin-plated aluminum |
| Function | Connects grounding conductor to XR rail |
| Coverage | One lug per rail row (bonds entire row) |

### Installation Rules

- One ground lug per continuous rail row
- Connect equipment grounding conductor per NEC requirements
- With UFO/CAMO integrated bonding, modules are grounded through clamp-to-rail path; lug provides the connection to the grounding conductor

### Quantity Formula

```
Ground lugs = number_of_rail_rows
```

Typically 1 per row of rails (each row has its own ground lug connected to the EGC).

---

## Complete System BOM Formula Summary

For a single rail row with N modules:

| Component | Quantity |
|-----------|----------|
| XR rail (14 ft sections) | ceil(row_length / 168") |
| BOSS splice | (number_of_rails - 1) |
| HUG roof attachment | per span table (typically every 4-5 ft) |
| RD structural screw | 1 per HUG minimum |
| T-bolt | 1 per HUG |
| UFO mid clamp | (N - 1) |
| UFO end clamp OR CAMO | 2 |
| Ground lug | 1 |

**Torque summary (all use 7/16" socket):**
- UFO mid clamp: 80 in-lbs
- UFO end clamp: 80 in-lbs
- T-bolt: 80 in-lbs
- CAMO: tool-free (no torque)

---

## References

- IronRidge XR Rail product page: https://www.ironridge.com/component/xr-rails/
- IronRidge UFO product page: https://www.ironridge.com/component/ufo/
- IronRidge CAMO product page: https://www.ironridge.com/component/camo/
- IronRidge BOSS product page: https://www.ironridge.com/component/boss/
- IronRidge HUG product page: https://www.ironridge.com/component/halo-ultragrip/
- IronRidge Parts Catalog (PDF): https://files.ironridge.com/IronRidge_Parts_Catalog.pdf
- IronRidge Flush Mount Installation Manual: https://files.ironridge.com/pitched-roof-mounting/resources/brochures/IronRidge_Flush_Mount_Installation_Manual.pdf
- IronRidge Design Assistant (span tables): https://base.ironridge.com
