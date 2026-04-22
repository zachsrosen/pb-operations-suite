"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { AdderCategory } from "@/generated/prisma/enums";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { VALID_SHOPS } from "@/lib/adders/pricing";
import AdderEditForm from "./AdderEditForm";
import SyncStatusBadge from "./SyncStatusBadge";
import type { SerializedAdder } from "./types";

type ActiveFilter = "active" | "inactive" | "all";

export interface AddersClientProps {
  initialAdders: SerializedAdder[];
}

async function fetchAdders(): Promise<SerializedAdder[]> {
  // Fetch all adders; client-side filters handle the rest.
  const r = await fetch(`/api/adders`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = (await r.json()) as { adders?: SerializedAdder[] };
  return json.adders ?? [];
}

const CATEGORY_OPTIONS = Object.values(AdderCategory).map((c) => ({
  value: c,
  label: c,
}));

const SHOP_OPTIONS = VALID_SHOPS.map((s) => ({ value: s, label: s }));

function formatUnit(unit: string): string {
  switch (unit) {
    case "FLAT":
      return "flat";
    case "PER_MODULE":
      return "per module";
    case "PER_KW":
      return "per kW";
    case "PER_LINEAR_FT":
      return "per LF";
    case "PER_HOUR":
      return "per hour";
    case "TIERED":
      return "tiered";
    default:
      return unit.toLowerCase();
  }
}

function formatPrice(adder: SerializedAdder): string {
  const n = Number(adder.basePrice);
  if (adder.type === "PERCENTAGE") {
    return `${adder.direction === "DISCOUNT" ? "−" : "+"}${n}%`;
  }
  const sign = adder.direction === "DISCOUNT" ? "−" : "+";
  const dollars = n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  return `${sign}${dollars}`;
}

export default function AddersClient({ initialAdders }: AddersClientProps) {
  const { data: session } = useSession();
  const canManage = useMemo(() => {
    const roles = session?.user?.roles ?? [];
    return roles.includes("ADMIN") || roles.includes("OWNER");
  }, [session?.user?.roles]);

  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [shopFilter, setShopFilter] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>("active");
  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SerializedAdder | null>(null);

  const { data: adders = initialAdders } = useQuery({
    queryKey: ["adders"],
    queryFn: fetchAdders,
    initialData: initialAdders,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return adders.filter((a) => {
      if (activeFilter === "active" && !a.active) return false;
      if (activeFilter === "inactive" && a.active) return false;
      if (categoryFilter.length > 0 && !categoryFilter.includes(a.category))
        return false;
      if (shopFilter.length > 0) {
        // Include adders that have an active override in any selected shop.
        const hasOverride = a.overrides.some(
          (o) => o.active && shopFilter.includes(o.shop)
        );
        if (!hasOverride) return false;
      }
      if (q) {
        const hay = `${a.code} ${a.name} ${a.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [adders, activeFilter, categoryFilter, shopFilter, search]);

  function openNew() {
    setEditTarget(null);
    setEditOpen(true);
  }

  function openEdit(a: SerializedAdder) {
    setEditTarget(a);
    setEditOpen(true);
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-t-border bg-surface p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by code, name, notes…"
          className="min-w-[240px] flex-1 rounded-md border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-green-500/40"
        />
        <MultiSelectFilter
          label="Category"
          options={CATEGORY_OPTIONS}
          selected={categoryFilter}
          onChange={setCategoryFilter}
          accentColor="green"
          placeholder="All categories"
        />
        <MultiSelectFilter
          label="Shop override"
          options={SHOP_OPTIONS}
          selected={shopFilter}
          onChange={setShopFilter}
          accentColor="green"
          placeholder="Any shop"
        />
        <div className="inline-flex overflow-hidden rounded-md border border-t-border">
          {(["active", "inactive", "all"] as ActiveFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActiveFilter(f)}
              className={`px-3 py-2 text-xs font-medium transition-colors ${
                activeFilter === f
                  ? "bg-green-500/15 text-green-500"
                  : "bg-surface text-muted hover:text-foreground"
              }`}
            >
              {f[0].toUpperCase()}{f.slice(1)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SyncStatusBadge />
          {canManage && (
            <button
              type="button"
              onClick={openNew}
              className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white shadow-card transition-colors hover:bg-green-500"
            >
              + New adder
            </button>
          )}
        </div>
      </div>

      {/* Summary row */}
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>
          Showing <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
          of {adders.length} adders
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-t-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-2.5">Code</th>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Category</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Direction</th>
              <th className="px-4 py-2.5">Base</th>
              <th className="px-4 py-2.5">Unit</th>
              <th className="px-4 py-2.5">Overrides</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Updated</th>
            </tr>
          </thead>
          <tbody className="stagger-grid">
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-10 text-center text-sm text-muted"
                >
                  No adders match the current filters.
                </td>
              </tr>
            )}
            {filtered.map((a) => {
              const activeOverrides = a.overrides.filter((o) => o.active).length;
              return (
                <tr
                  key={a.id}
                  onClick={() => openEdit(a)}
                  className="cursor-pointer border-t border-t-border transition-colors hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                    {a.code}
                  </td>
                  <td className="px-4 py-2.5 text-foreground">{a.name}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted ring-1 ring-t-border">
                      {a.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">{a.type}</td>
                  <td className="px-4 py-2.5 text-xs">
                    <span
                      className={
                        a.direction === "DISCOUNT"
                          ? "font-semibold text-red-400"
                          : "font-semibold text-green-500"
                      }
                    >
                      {a.direction === "DISCOUNT" ? "−" : "+"} {a.direction}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-foreground">
                    {formatPrice(a)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {formatUnit(a.unit)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {activeOverrides > 0 ? `${activeOverrides} shop` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {a.active ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-500 ring-1 ring-green-500/30">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-t-border">
                        Retired
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted">
                    {new Date(a.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Edit/create drawer */}
      <AdderEditForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        adder={editTarget}
        canManage={canManage}
      />
    </div>
  );
}
