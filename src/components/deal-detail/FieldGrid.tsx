import type { FieldDef } from "./types";
import { formatMoney } from "@/lib/format";

function formatFieldValue(field: FieldDef): string {
  if (field.value === null || field.value === undefined || field.value === "") {
    return "—";
  }

  switch (field.format) {
    case "date": {
      // ISO strings from serializeDeal() are UTC midnight (e.g. "2026-03-15T00:00:00.000Z").
      // Parsing directly would shift to the previous day in US timezones.
      // Strip time component and reconstruct as local midnight to match the existing pattern.
      const dateOnly = String(field.value).split("T")[0];
      const d = new Date(dateOnly + "T00:00:00");
      if (isNaN(d.getTime())) return "—";
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
    case "money":
      return formatMoney(Number(field.value));
    case "decimal":
      return String(Number(field.value).toFixed(1));
    case "days": {
      const n = Number(field.value);
      return Number.isFinite(n) ? `${n.toFixed(1)} days` : "—";
    }
    case "boolean":
      return field.value ? "Yes" : "No";
    case "status":
      return String(field.value);
    default:
      return String(field.value);
  }
}

function statusColor(field: FieldDef): string | undefined {
  if (field.format !== "status" || !field.value) return undefined;
  const v = String(field.value).toLowerCase();
  if (["complete", "completed", "issued", "approved", "passed"].some(k => v.includes(k))) {
    return "#22C55E";
  }
  if (["in progress", "pending", "submitted", "scheduled"].some(k => v.includes(k))) {
    return "#F97316";
  }
  return undefined;
}

interface FieldGridProps {
  fields: FieldDef[];
}

export default function FieldGrid({ fields }: FieldGridProps) {
  return (
    <div className="stagger-grid grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fields.map((field) => {
        const color = statusColor(field);
        return (
          <div key={field.label}>
            <div className="text-[9px] uppercase tracking-wider text-muted">
              {field.label}
            </div>
            <div className="text-sm text-foreground" style={color ? { color } : undefined}>
              {color && field.value ? "● " : ""}
              {formatFieldValue(field)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
