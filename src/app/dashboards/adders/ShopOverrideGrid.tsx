"use client";

import { VALID_SHOPS } from "@/lib/adders/pricing";

/** Row shape emitted by the grid. priceDelta is a number for JSON submission. */
export type ShopOverrideRow = {
  shop: string;
  priceDelta: number;
  active: boolean;
};

export interface ShopOverrideGridProps {
  value: ShopOverrideRow[];
  onChange: (next: ShopOverrideRow[]) => void;
  disabled?: boolean;
}

/**
 * Normalize grid state into the submission array the API expects:
 * - drops rows with priceDelta=0 AND active=false (no-op rows)
 * - keeps rows with non-zero delta regardless of active flag
 * - keeps rows explicitly toggled active=false with non-zero delta (so a
 *   temporarily-disabled override can be preserved on round-trip)
 */
export function normalizeOverrides(rows: ShopOverrideRow[]): ShopOverrideRow[] {
  return rows.filter((r) => r.priceDelta !== 0 || r.active);
}

/** Build a complete 5-row dataset from a (possibly partial) array. */
export function hydrateRows(
  existing: Array<{ shop: string; priceDelta: string | number; active: boolean }>
): ShopOverrideRow[] {
  const byShop = new Map<string, ShopOverrideRow>();
  for (const o of existing) {
    byShop.set(o.shop, {
      shop: o.shop,
      priceDelta: typeof o.priceDelta === "string" ? Number(o.priceDelta) : o.priceDelta,
      active: o.active,
    });
  }
  return VALID_SHOPS.map(
    (shop) => byShop.get(shop) ?? { shop, priceDelta: 0, active: false }
  );
}

export default function ShopOverrideGrid({ value, onChange, disabled }: ShopOverrideGridProps) {
  function update(shop: string, patch: Partial<ShopOverrideRow>) {
    onChange(
      value.map((row) => (row.shop === shop ? { ...row, ...patch } : row))
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-t-border bg-surface">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2">Shop</th>
            <th className="px-3 py-2">Price delta ($)</th>
            <th className="px-3 py-2">Active</th>
          </tr>
        </thead>
        <tbody>
          {value.map((row) => (
            <tr key={row.shop} className="border-t border-t-border">
              <td className="px-3 py-2 font-medium text-foreground">{row.shop}</td>
              <td className="px-3 py-2">
                <input
                  type="number"
                  step="any"
                  disabled={disabled}
                  value={row.priceDelta}
                  onChange={(e) =>
                    update(row.shop, { priceDelta: Number(e.target.value) })
                  }
                  className="w-32 rounded-md border border-t-border bg-surface-2 px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-green-500/40 disabled:opacity-50"
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={row.active}
                  onChange={(e) => update(row.shop, { active: e.target.checked })}
                  className="h-4 w-4 rounded border-t-border text-green-600 focus:ring-green-500/40"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-t-border px-3 py-2 text-xs text-muted">
        Positive delta adds to the base price; negative delta subtracts. Rows with
        delta 0 + inactive are discarded on save.
      </p>
    </div>
  );
}
