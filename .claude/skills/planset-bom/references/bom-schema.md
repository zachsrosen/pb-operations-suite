# BOM Output Schema

## Overview

The BOM output maps to the existing PB Operations Suite `EquipmentSku` schema so it can be imported directly into the inventory system via `/api/inventory/sync-skus`.

---

## EquipmentSku Schema (from Prisma)

```typescript
model EquipmentSku {
  id        String            // Auto-generated
  category  EquipmentCategory // MODULE | INVERTER | BATTERY | EV_CHARGER (+ extended below)
  brand     String            // Manufacturer name
  model     String            // Model number/name
  unitSpec  String?           // Rating: "440W", "13.5kWh", "200A"
  unitLabel String?           // Unit type: "W", "kWh", "kW", "A"
  isActive  Boolean
}
```

## Extended Categories for Full BOM

The base schema uses `MODULE | INVERTER | BATTERY | EV_CHARGER`. The full planset BOM needs additional categories. Use these string values in the BOM output JSON (the sync endpoint accepts freeform category strings):

| Category String | Description | Examples |
|----------------|-------------|---------|
| `MODULE` | Solar PV modules | SEG Solar SEG-440-BTD-BG |
| `BATTERY` | Battery storage (Powerwall acts as inverter+battery) | Tesla Powerwall-3 |
| `INVERTER` | Standalone inverters (if not Powerwall) | SolarEdge SE7600H |
| `EV_CHARGER` | EV charging equipment | — |
| `RACKING` | All mounting/racking hardware | IronRidge XR10, HUG attachments, clamps, screws |
| `ELECTRICAL_BOS` | Balance of system electrical | Wire, conduit, J-box, disconnect, breaker, lugs |
| `RAPID_SHUTDOWN` | Rapid shutdown devices | Tesla MCI-2 |
| `MONITORING` | Gateway, comms, meters | Tesla Backup Gateway-3, Xcel PV meter |

---

## BOM Line Item Structure

Each extracted line item should be structured as:

```json
{
  "lineItem": "SOLAR PV MODULE",
  "category": "MODULE",
  "brand": "SEG Solar",
  "model": "SEG-440-BTD-BG",
  "description": "SEG SOLAR SEG-440-BTD-BG (440W) MODULES",
  "qty": 16,
  "unitSpec": "440W",
  "unitLabel": "W",
  "source": "PV-2",
  "flags": []
}
```

Flag values: `"INFERRED"`, `"ASSUMED_BRAND"`, `"VALIDATION_WARNING"`, `"EXISTING_EQUIPMENT"`

---

## Full BOM Document Structure

```json
{
  "project": {
    "address": "1516 LANDON CT, WINDSOR, CO 80550",
    "customer": "CANTWELL, SEAN",
    "apn": "R1616661",
    "utility": "PVREA",
    "ahj": "TOWN OF WINDSOR",
    "plansetRev": "REV_B",
    "stampDate": "16-DEC-2025",
    "systemSizeKwdc": 7.040,
    "systemSizeKwac": 11.500,
    "moduleCount": 16,
    "roofType": "ASPHALT SHINGLE"
  },
  "items": [
    {
      "lineItem": "SOLAR PV MODULE",
      "category": "MODULE",
      "brand": "SEG Solar",
      "model": "SEG-440-BTD-BG",
      "description": "SEG SOLAR SEG-440-BTD-BG (440W) MODULES",
      "qty": 16,
      "unitSpec": "440W",
      "unitLabel": "W",
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "BATTERY & INVERTER",
      "category": "BATTERY",
      "brand": "Tesla",
      "model": "Powerwall-3",
      "description": "TESLA POWERWALL-3 (1707000-XX-Y)",
      "qty": 1,
      "unitSpec": "13.5kWh",
      "unitLabel": "kWh",
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "RAPID SHUTDOWN",
      "category": "RAPID_SHUTDOWN",
      "brand": "Tesla",
      "model": "MCI-2",
      "description": "TESLA MCI-2 RAPID SHUTDOWN DEVICES",
      "qty": 7,
      "unitSpec": null,
      "unitLabel": null,
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "RAIL",
      "category": "RACKING",
      "brand": "IronRidge",
      "model": "XR10",
      "description": "IRONRIDGE XR10 RAIL 168\"",
      "qty": 15,
      "unitSpec": "168\"",
      "unitLabel": "in",
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "ATTACHMENT",
      "category": "RACKING",
      "brand": "IronRidge",
      "model": "Quickmount Halo Ultragrip (HUG)",
      "description": "IRONRIDGE QUICKMOUNT HALO ULTRAGRIP (HUG) ATTACHMENTS",
      "qty": 62,
      "unitSpec": null,
      "unitLabel": null,
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "RD STRUCTURAL SCREW",
      "category": "RACKING",
      "brand": "IronRidge",
      "model": "HW-RD1430-01-M1",
      "description": "HW-RD1430-01-M1 RD STRUCTURAL SCREW, 3.0L",
      "qty": 124,
      "unitSpec": "3.0L",
      "unitLabel": null,
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "DC WIRE",
      "category": "ELECTRICAL_BOS",
      "brand": null,
      "model": "PV-WIRE",
      "description": "PV-WIRE, 10 AWG, 8 CONDUCTORS, FREE AIR (TAG A)",
      "qty": 1,
      "unitSpec": "10 AWG",
      "unitLabel": "AWG",
      "source": "PV-4",
      "flags": []
    },
    {
      "lineItem": "AC WIRE",
      "category": "ELECTRICAL_BOS",
      "brand": null,
      "model": "THWN-2",
      "description": "LINE:THWN-2, 6 AWG, 2 CONDUCTORS, 3/4\" EMT/PVC/FMC (TAG C)",
      "qty": 1,
      "unitSpec": "6 AWG",
      "unitLabel": "AWG",
      "source": "PV-4",
      "flags": []
    },
    {
      "lineItem": "JUNCTION BOX",
      "category": "ELECTRICAL_BOS",
      "brand": "EZ Solar",
      "model": "JB-1.2",
      "description": "EZ SOLAR JB-1.2, 1000V, 80A MAX, MOUNTED ON ROOF",
      "qty": 1,
      "unitSpec": "80A, 1000V",
      "unitLabel": null,
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "AC DISCONNECT",
      "category": "ELECTRICAL_BOS",
      "brand": null,
      "model": "60A NON-FUSED AC DISCONNECT",
      "description": "60A NON-FUSED AC DISCONNECT, 240VAC",
      "qty": 1,
      "unitSpec": "60A",
      "unitLabel": "A",
      "source": "PV-2",
      "flags": []
    },
    {
      "lineItem": "TESLA BACKUP GATEWAY 3",
      "category": "MONITORING",
      "brand": "Tesla",
      "model": "Backup Gateway-3",
      "description": "200A TESLA BACKUP GATEWAY-3 (1841000-X1-Y), NEMA 3R, UL LISTED",
      "qty": 1,
      "unitSpec": "200A",
      "unitLabel": "A",
      "source": "PV-2",
      "flags": []
    }
  ],
  "validation": {
    "moduleCountMatch": true,
    "batteryCapacityMatch": true,
    "ocpdMatch": true,
    "warnings": []
  },
  "generatedAt": "2026-02-20T00:00:00Z"
}
```

---

## CSV Column Order

When exporting to CSV, use this column order:

```
category,brand,model,description,qty,unitSpec,unitLabel,source,flags
```

Example rows:
```csv
category,brand,model,description,qty,unitSpec,unitLabel,source,flags
MODULE,SEG Solar,SEG-440-BTD-BG,"SEG SOLAR SEG-440-BTD-BG (440W) MODULES",16,440W,W,PV-2,
BATTERY,Tesla,Powerwall-3,"TESLA POWERWALL-3 (1707000-XX-Y)",1,13.5kWh,kWh,PV-2,
RAPID_SHUTDOWN,Tesla,MCI-2,"TESLA MCI-2 RAPID SHUTDOWN DEVICES",7,,,PV-2,
RACKING,IronRidge,XR10,"IRONRIDGE XR10 RAIL 168""",15,168",in,PV-2,
RACKING,IronRidge,Quickmount Halo Ultragrip (HUG),"IRONRIDGE QUICKMOUNT HALO ULTRAGRIP (HUG) ATTACHMENTS",62,,,PV-2,
RACKING,IronRidge,HW-RD1430-01-M1,"HW-RD1430-01-M1 RD STRUCTURAL SCREW 3.0L",124,3.0L,,PV-2,
RACKING,,Splice Kit,"BONDED SPLICE KIT",0,,,PV-2,
RACKING,,Mid Clamp,"MODULES CLAMPS (MID CLAMP)",8,,,PV-2,
RACKING,,End Clamp,"MODULES CLAMPS (END CLAMP)",48,,,PV-2,
ELECTRICAL_BOS,,Ground Lug,"GROUND LUG",12,,,PV-2,
ELECTRICAL_BOS,EZ Solar,JB-1.2,"EZ SOLAR JB-1.2 1000V 80A MAX",1,"80A, 1000V",,PV-2,
ELECTRICAL_BOS,,60A Non-Fused AC Disconnect,"60A NON-FUSED AC DISCONNECT 240VAC",1,60A,A,PV-2,
ELECTRICAL_BOS,,PV-WIRE,"PV-WIRE 10 AWG 8 CONDUCTORS FREE AIR (TAG A)",1,10 AWG,AWG,PV-4,
ELECTRICAL_BOS,,THHN/THWN-2,"LINE:THHN/THWN-2 10 AWG 8 CONDUCTORS 3/4"" EMT (TAG B)",1,10 AWG,AWG,PV-4,
ELECTRICAL_BOS,,THWN-2,"LINE:THWN-2 6 AWG 2 CONDUCTORS 3/4"" EMT (TAG C)",1,6 AWG,AWG,PV-4,
ELECTRICAL_BOS,,THWN-2,"LINE:THWN-2 3/0 AWG 2 CONDUCTORS 2"" EMT (TAG D)",1,3/0 AWG,AWG,PV-4,
MONITORING,Tesla,Backup Gateway-3,"200A TESLA BACKUP GATEWAY-3 NEMA 3R UL LISTED",1,200A,A,PV-2,
```

---

## Markdown Table Format

When outputting as markdown, group by category:

```markdown
## BOM — [Customer Name] | [Address] | [Date]
**System:** [N] modules | [kWdc] kWdc / [kWac] kWac | Rev [X]

### Modules
| Category | Brand | Model | Description | Qty | Spec |
|----------|-------|-------|-------------|-----|------|
| MODULE | SEG Solar | SEG-440-BTD-BG | SEG SOLAR SEG-440-BTD-BG (440W) MODULES | 16 | 440W |

### Storage & Inverter
...

### Racking & Mounting
...

### Electrical BOS
...

### Monitoring & Controls
...

### Validation
- ✅ Module count matches string layout (16 = 5+4+4+3)
- ✅ Battery capacity confirmed (13.5 kWh on PV-6)
- ✅ OCPD matches disconnect (60A)
```
