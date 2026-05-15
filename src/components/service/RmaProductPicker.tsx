"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EquipmentCategory } from "@/generated/prisma/enums";

export interface RmaPickerItem {
  productId: string;
  brand: string;
  model: string;
  category: EquipmentCategory;
  quantity: number;
  unitSpecLabel: string | null;
  zohoItemId: string | null;
  hubspotProductId: string | null;
}

interface Props {
  items: RmaPickerItem[];
  onItemsChange: (items: RmaPickerItem[]) => void;
  label: string;
}

async function searchCatalog(q: string) {
  const r = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return r.json();
}

const CATEGORY_COLORS: Record<string, string> = {
  MODULE: "bg-yellow-500/20 text-yellow-400",
  INVERTER: "bg-blue-500/20 text-blue-400",
  BATTERY: "bg-green-500/20 text-green-400",
  BATTERY_EXPANSION: "bg-green-500/20 text-green-400",
  EV_CHARGER: "bg-purple-500/20 text-purple-400",
  RACKING: "bg-orange-500/20 text-orange-400",
  ELECTRICAL_BOS: "bg-red-500/20 text-red-400",
  MONITORING: "bg-cyan-500/20 text-cyan-400",
};

export default function RmaProductPicker({ items, onItemsChange, label }: Props) {
  const [query, setQuery] = useState("");

  const { data: results = [] } = useQuery({
    queryKey: ["catalog-search", query],
    queryFn: () => searchCatalog(query),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });

  const addItem = (product: {
    id: string;
    brand: string;
    model: string;
    category: EquipmentCategory;
    unitSpec: number | null;
    unitLabel: string | null;
    zohoItemId: string | null;
    hubspotProductId: string | null;
  }) => {
    const existing = items.find((i) => i.productId === product.id);
    if (existing) {
      onItemsChange(
        items.map((i) =>
          i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
    } else {
      const unitSpecLabel =
        product.unitSpec != null && product.unitLabel
          ? `${product.unitSpec}${product.unitLabel}`
          : null;
      onItemsChange([
        ...items,
        {
          productId: product.id,
          brand: product.brand,
          model: product.model,
          category: product.category,
          quantity: 1,
          unitSpecLabel,
          zohoItemId: product.zohoItemId ?? null,
          hubspotProductId: product.hubspotProductId ?? null,
        },
      ]);
    }
    setQuery("");
  };

  const updateQuantity = (productId: string, qty: number) => {
    if (qty < 1) {
      onItemsChange(items.filter((i) => i.productId !== productId));
    } else {
      onItemsChange(
        items.map((i) => (i.productId === productId ? { ...i, quantity: qty } : i))
      );
    }
  };

  const removeItem = (productId: string) => {
    onItemsChange(items.filter((i) => i.productId !== productId));
  };

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">
        {label}
      </label>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products by brand, model, or SKU..."
        className="w-full bg-surface-2 border border-t-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted mb-2"
      />

      {query.length >= 2 && results.length > 0 && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-t-border bg-surface-2 mb-3">
          {results.map(
            (p: {
              id: string;
              brand: string;
              model: string;
              category: EquipmentCategory;
              unitSpec: number | null;
              unitLabel: string | null;
              zohoItemId: string | null;
              hubspotProductId: string | null;
            }) => (
              <button
                key={p.id}
                onClick={() => addItem(p)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-surface flex items-center gap-2 border-b border-t-border last:border-b-0"
              >
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${CATEGORY_COLORS[p.category] ?? "bg-zinc-500/20 text-zinc-400"}`}
                >
                  {p.category}
                </span>
                <span className="text-foreground">
                  {p.brand} {p.model}
                </span>
                {p.unitSpec != null && p.unitLabel && (
                  <span className="text-muted text-xs">
                    {p.unitSpec}
                    {p.unitLabel}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.productId}
              className="flex items-center gap-3 rounded-lg border border-t-border bg-surface px-3 py-2 text-sm"
            >
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium shrink-0 ${CATEGORY_COLORS[item.category] ?? "bg-zinc-500/20 text-zinc-400"}`}
              >
                {item.category}
              </span>
              <span className="text-foreground flex-1 min-w-0 truncate">
                {item.brand} {item.model}
                {item.unitSpecLabel && (
                  <span className="text-muted ml-1">{item.unitSpecLabel}</span>
                )}
              </span>
              <input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) =>
                  updateQuantity(item.productId, parseInt(e.target.value) || 1)
                }
                className="w-16 bg-surface-2 border border-t-border rounded px-2 py-1 text-sm text-foreground text-center"
              />
              <button
                onClick={() => removeItem(item.productId)}
                className="text-muted hover:text-red-400 text-lg leading-none"
                aria-label="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
