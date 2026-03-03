/**
 * Equipment Visual Config for Design Approval Photos
 *
 * Maps BOM equipment types to visual representations (colored rectangles)
 * used when composing the equipment overlay on design approval images.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EquipmentVisual {
  /** Hex fill color for the rectangle */
  color: string;
  /** Hex text color rendered on the rectangle */
  textColor: string;
  /** Short label displayed inside the rectangle */
  label: string;
  /** Real-world width in feet (used for proportional scaling) */
  widthFt: number;
  /** Real-world height in feet (used for proportional scaling) */
  heightFt: number;
  /** Optional icon path (Phase 2) */
  icon?: string;
}

export type EquipmentKey =
  | "battery"
  | "expansion"
  | "inverter"
  | "gateway"
  | "backup_switch"
  | "main_panel"
  | "sub_panel"
  | "meter"
  | "disconnect"
  | "ev_charger";

// ---------------------------------------------------------------------------
// Visual definitions
// ---------------------------------------------------------------------------

export const EQUIPMENT_VISUALS: Record<EquipmentKey, EquipmentVisual> = {
  battery: {
    color: "#3B82F6",
    textColor: "#FFFFFF",
    label: "PW3",
    widthFt: 2.8,
    heightFt: 1.1,
  },
  expansion: {
    color: "#60A5FA",
    textColor: "#FFFFFF",
    label: "PW3 EXP",
    widthFt: 2.8,
    heightFt: 1.1,
  },
  inverter: {
    color: "#F97316",
    textColor: "#FFFFFF",
    label: "INV",
    widthFt: 1.5,
    heightFt: 1.0,
  },
  gateway: {
    color: "#14B8A6",
    textColor: "#FFFFFF",
    label: "GW3",
    widthFt: 0.8,
    heightFt: 0.5,
  },
  backup_switch: {
    color: "#F59E0B",
    textColor: "#FFFFFF",
    label: "BU SW",
    widthFt: 1.0,
    heightFt: 0.6,
  },
  main_panel: {
    color: "#6B7280",
    textColor: "#FFFFFF",
    label: "PANEL",
    widthFt: 2.0,
    heightFt: 1.0,
  },
  sub_panel: {
    color: "#9CA3AF",
    textColor: "#FFFFFF",
    label: "SUB",
    widthFt: 1.5,
    heightFt: 0.8,
  },
  meter: {
    color: "#22C55E",
    textColor: "#FFFFFF",
    label: "METER",
    widthFt: 0.8,
    heightFt: 0.5,
  },
  disconnect: {
    color: "#EF4444",
    textColor: "#FFFFFF",
    label: "DISC",
    widthFt: 0.6,
    heightFt: 0.4,
  },
  ev_charger: {
    color: "#A855F7",
    textColor: "#FFFFFF",
    label: "EV",
    widthFt: 1.0,
    heightFt: 0.8,
  },
};

// ---------------------------------------------------------------------------
// BOM item -> equipment key resolver
// ---------------------------------------------------------------------------

interface BomItemInput {
  category: string;
  model?: string;
  description?: string;
}

/**
 * Resolve a BOM line-item to an EquipmentKey for visual rendering.
 * Returns `null` for items that should not appear on the equipment layout
 * (wire, conduit, lugs, racking, rapid shutdown, modules, etc.).
 */
export function resolveEquipmentKey(
  item: BomItemInput
): EquipmentKey | null {
  const cat = item.category?.toUpperCase() ?? "";
  const model = (item.model ?? "").toLowerCase();
  const desc = (item.description ?? "").toLowerCase();

  switch (cat) {
    case "BATTERY": {
      if (model.includes("1807000") || desc.includes("expansion")) {
        return "expansion";
      }
      return "battery";
    }

    case "INVERTER":
      return "inverter";

    case "EV_CHARGER":
      return "ev_charger";

    case "MONITORING": {
      if (model.includes("1841000") || desc.includes("gateway")) {
        return "gateway";
      }
      if (desc.includes("meter")) {
        return "meter";
      }
      // Default monitoring equipment to gateway
      return "gateway";
    }

    case "ELECTRICAL_BOS": {
      if (desc.includes("disconnect")) {
        return "disconnect";
      }
      if (desc.includes("backup switch") || model.includes("1624171")) {
        return "backup_switch";
      }
      if (desc.includes("sub") && desc.includes("panel")) {
        return "sub_panel";
      }
      // Skip wire, conduit, lugs, breakers, etc.
      return null;
    }

    // Racking, rapid shutdown, modules, and everything else -- skip
    default:
      return null;
  }
}
