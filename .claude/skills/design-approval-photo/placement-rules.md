# Equipment Placement Rules Reference

Reference for AI-assisted equipment placement on residential site photos. Codifies standard Photon Brothers installation practices and NEC (National Electrical Code) requirements.

---

## General Principles

1. **Main panel is the anchor** -- most equipment is placed relative to the main electrical panel. Identify it first, then position everything else around it.
2. **Minimize conduit runs** -- keep wire runs as short as practical. Shorter runs reduce material cost, voltage drop, and installation labor.
3. **Accessible for maintenance** -- NEC 110.26 requires a minimum 36" clear workspace in front of all electrical equipment (panels, disconnects, batteries). This space must be unobstructed from floor to a height of 6.5 ft.
4. **Weather protection preferred** -- garage interior or covered/sheltered areas are preferred mounting locations. Exterior mounts require weatherproof enclosures and may need additional UV and rain protection.
5. **Structural mounting surface** -- equipment must mount to surfaces that can support the weight. Batteries (Powerwall 3 ~130 lbs each) require stud-backed drywall, concrete, or structural framing. Lightweight materials like thin plywood or unsupported drywall are not acceptable.
6. **Code clearances from openings** -- maintain required clearances from windows, doors, and ventilation openings per local jurisdiction amendments.

---

## Equipment-Specific Rules

### Battery (Tesla Powerwall 3)

| Parameter | Requirement |
|-----------|-------------|
| Preferred location | Garage wall interior |
| Distance from main panel | Adjacent, within 10 ft |
| Front clearance | 36" minimum (NEC 110.26) |
| Multiple units | Stack vertically (preferred) or mount side-by-side |
| Gas appliance separation | 3 ft minimum from water heaters, furnaces, or gas lines |
| Mounting surface | Concrete, stud-backed drywall, or structural framing |
| Weight | ~130 lbs per unit -- confirm wall can support |
| Orientation | Vertical only, connectors face down |
| Temperature | Avoid direct sunlight exposure; garage interior preferred for thermal performance |

### Gateway 3

| Parameter | Requirement |
|-----------|-------------|
| Distance from main panel | Within 5 ft |
| Position relative to panel | Above or beside the panel |
| Connectivity | Needs WiFi signal -- verify coverage at proposed location |
| Mounting | Wall-mounted, lightweight, no structural concerns |
| Purpose | System communication hub; monitors CTs on main panel feeds |

### Backup Switch (Tesla Backup Switch)

| Parameter | Requirement |
|-----------|-------------|
| Position | Between main panel and Gateway 3 |
| Distance from panel | As close to the main panel as possible |
| Front clearance | 36" minimum (NEC 110.26) |
| Purpose | Transfers loads between grid and battery during outage |
| Wiring | Feeds from main panel, outputs to backed-up loads |

### AC Disconnect

| Parameter | Requirement |
|-----------|-------------|
| Location | Exterior mount, within line of sight of utility meter (NEC 690.13) |
| Accessibility | Must be accessible to utility personnel |
| Position | Near the solar conduit entry point to the building |
| Mount surface | Exterior wall, weatherproof enclosure |
| Purpose | Allows utility to disconnect solar generation from the grid |

### Sub-Panel

| Parameter | Requirement |
|-----------|-------------|
| Position | Adjacent to main panel |
| When used | When main panel has insufficient breaker slots for new circuits |
| Front clearance | 36" minimum (NEC 110.26) |
| Sizing | Typically 60A-100A sub-feed from main panel |

### Meter (Production / PV Meter)

| Parameter | Requirement |
|-----------|-------------|
| Location | Exterior mount |
| Accessibility | Must be utility-accessible (no locked gates, no interior walls) |
| Position | Near the interconnection point (where solar ties to grid) |
| Purpose | Measures solar production for net metering or utility reporting |

### EV Charger

| Parameter | Requirement |
|-----------|-------------|
| Location | Near parking area or garage door |
| Cable reach | Within reach of vehicle charge port (typically driver-side rear) |
| Circuit | Dedicated 50A-60A circuit from panel |
| Height | ~48" to center of unit from finished floor |
| Front clearance | Enough space for vehicle plus cable management |

---

## Stacking and Layout Patterns

### Single Battery + Gateway

```
              Main Panel
              +--------+
              |        |
              |  MAIN  |
              |  PANEL |
              |        |
              +--------+

  Gateway 3       Backup Switch
  +------+        +--------+
  |  GW  |        |  BU SW |
  +------+        +--------+

              Powerwall 3
              +----------+
              |          |
              |   PW3    |
              |          |
              +----------+

         |<--- 36" clear --->|
```

- Gateway and Backup Switch mount above or beside the panel.
- Single Powerwall adjacent to the panel, on the same wall when possible.
- Maintain 36" clearance in front of all equipment.

### Dual Battery -- Side by Side

```
              Main Panel
              +--------+
              |        |
              |  MAIN  |
              |  PANEL |
              |        |
              +--------+
  +------+              +--------+
  |  GW  |              |  BU SW |
  +------+              +--------+

  +----------+  +----------+
  |          |  |          |
  |   PW3   |  |   PW3    |
  |   #1    |  |   #2     |
  |          |  |          |
  +----------+  +----------+

  |<------ 36" clear ------>|
```

- Side-by-side when wall width allows (~5 ft minimum horizontal span for two units).
- Both units at the same height for clean conduit routing.

### Dual Battery -- Stacked

```
              Main Panel
              +--------+
              |        |
              |  MAIN  |
              |  PANEL |
              |        |
              +--------+
  +------+   +--------+
  |  GW  |   |  BU SW |
  +------+   +--------+

              +----------+
              |          |
              |   PW3    |
              |   #2     |
              |          |
              +----------+
              +----------+
              |          |
              |   PW3    |
              |   #1     |
              |          |
              +----------+

         |<--- 36" clear --->|
```

- Stacked when horizontal wall space is limited.
- Bottom unit (#1) installed first, top unit (#2) stacked above.
- Confirm wall structure can support ~260 lbs combined at mounting height.
- Top of upper unit should not exceed ~7 ft from floor for serviceability.

---

## Photo Analysis Guidance

When analyzing a site photo for equipment placement, identify the following elements in order:

### 1. Existing Main Panel

- Typically a gray or black rectangular metal box on the wall.
- May have a utility meter nearby (exterior) or be inside the garage.
- This is the anchor point -- all other equipment positions are relative to it.

### 2. Available Wall Space

- Look for continuous, unobstructed wall sections adjacent to the main panel.
- Measure (estimate) horizontal and vertical clearance.
- A single Powerwall 3 needs roughly 26" wide x 62" tall of wall space.
- Prefer the same wall as the panel to minimize conduit runs.

### 3. Obstructions

Flag anything that limits placement:
- Windows and doors (cannot mount over them)
- Pipes, conduit, gas lines (maintain clearance)
- HVAC equipment, ductwork
- Water heater or furnace (3 ft minimum from batteries)
- Electrical sub-panels or junction boxes already present
- Shelving, cabinets, or storage that would need to be moved

### 4. Mounting Surface

Identify the wall material:
- **Drywall over studs** -- acceptable for all equipment if studs are located
- **Concrete / CMU block** -- acceptable, requires tapcon or concrete anchors
- **Stucco (exterior)** -- acceptable with proper flashing and weatherproofing
- **Thin plywood or paneling** -- not acceptable for heavy equipment without backing

### 5. Floor / Ground Space

- Verify 36" of clear floor space in front of proposed equipment locations.
- Check for items on the floor that would block access (storage, vehicles, workbenches).
- For garage installs, confirm equipment will not conflict with vehicle parking.

### 6. Utility Meter Location

- Usually exterior, near the main panel or on the opposite side of the same wall.
- AC disconnect must be within line of sight of the meter.
- Production meter (if required) mounts near the meter or interconnection point.

---

## Quick Reference: Clearance Summary

| Equipment | Front Clearance | Side Clearance | From Gas Appliances |
|-----------|----------------|----------------|---------------------|
| Battery (PW3) | 36" | 6" between units | 36" |
| Gateway 3 | 36" | -- | -- |
| Backup Switch | 36" | -- | -- |
| Main Panel | 36" wide x 36" deep x 78" high | -- | -- |
| AC Disconnect | 36" | -- | -- |
| Sub-Panel | 36" | -- | -- |
