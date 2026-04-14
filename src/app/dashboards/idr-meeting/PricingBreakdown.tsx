"use client";

import { useMemo } from "react";
import type { IdrItem } from "./IdrMeetingClient";
import {
  calcPrice,
  matchLineItemToEquipment,
  EQUIPMENT_CATALOG,
  LOCATION_SCHEME,
  type CalcInput,
  type EquipmentSelection,
} from "@/lib/pricing-calculator";
import { normalizeLocation } from "@/lib/locations";

interface LineItem {
  name: string;
  quantity: number;
  manufacturer: string;
  productCategory: string;
  sku: string;
  price: number;
  amount: number;
}

interface Props {
  item: IdrItem;
  lineItems: LineItem[] | undefined;
}

function resolveRoofTypeId(item: IdrItem): string {
  if (item.adderTileRoof) return "tile";
  if (item.adderMetalRoof) return "metal";
  if (item.adderFlatFoamRoof) return "flat";
  if (item.adderShakeRoof) return "shake";
  return "comp";
}

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function PricingBreakdown({ item, lineItems }: Props) {
  const result = useMemo(() => {
    if (!lineItems || lineItems.length === 0) return null;

    const modules: EquipmentSelection[] = [];
    const inverters: EquipmentSelection[] = [];
    const batteries: EquipmentSelection[] = [];
    const otherEquip: EquipmentSelection[] = [];
    const unmatched: string[] = [];

    for (const li of lineItems) {
      const code = matchLineItemToEquipment(li.name, li.sku, li.productCategory, li.manufacturer);
      if (!code) {
        unmatched.push(li.name);
        continue;
      }
      const eq = EQUIPMENT_CATALOG.find((e) => e.code === code);
      if (!eq) { unmatched.push(li.name); continue; }
      const sel = { code, qty: li.quantity };
      switch (eq.category) {
        case "module": modules.push(sel); break;
        case "inverter": inverters.push(sel); break;
        case "battery": batteries.push(sel); break;
        default: otherEquip.push(sel); break;
      }
    }

    const normalized = normalizeLocation(item.region);
    const schemeId = normalized ? (LOCATION_SCHEME[normalized] ?? "base") : "base";
    const locationWarning = !normalized ? "Unknown location — using default pricing scheme" : null;

    const customs = Array.isArray(item.customAdders) ? item.customAdders : [];
    const customTotal = customs.reduce(
      (sum: number, c: { amount?: number }) => sum + (typeof c.amount === "number" ? c.amount : 0),
      0,
    );

    const input: CalcInput = {
      modules,
      inverters,
      batteries,
      otherEquip,
      pricingSchemeId: schemeId,
      roofTypeId: resolveRoofTypeId(item),
      storeyId: item.adderTwoStorey ? "2" : "1",
      pitchId: item.adderSteepPitch ? "steep1" : "none",
      activeAdderIds: [],
      customFixedAdder: customTotal,
    };

    const breakdown = calcPrice(input);
    return { breakdown, unmatched, locationWarning };
  }, [item, lineItems]);

  if (!lineItems) {
    return <div className="h-5 w-48 rounded bg-surface-2 animate-pulse" />;
  }
  if (lineItems.length === 0) {
    return <p className="text-xs text-muted">No equipment data available</p>;
  }
  if (!result) return null;

  const { breakdown, unmatched, locationWarning } = result;
  const ppw = breakdown.totalWatts > 0 ? breakdown.finalPrice / breakdown.totalWatts : 0;
  const delta = (item.dealAmount ?? 0) - breakdown.finalPrice;
  const deltaPct = item.dealAmount ? Math.abs(delta / item.dealAmount) * 100 : null;
  const isPeTag = item.tags?.some((t) => t.toLowerCase().includes("participate"));

  let deltaColor = "text-emerald-400";
  let deltaBg = "bg-emerald-500/10 border-emerald-500/30";
  if (deltaPct !== null && deltaPct >= 15) {
    deltaColor = "text-red-400";
    deltaBg = "bg-red-500/10 border-red-500/30";
  } else if (deltaPct !== null && deltaPct >= 5) {
    deltaColor = "text-yellow-400";
    deltaBg = "bg-yellow-500/10 border-yellow-500/30";
  }

  return (
    <div className="space-y-3">
      {locationWarning && (
        <p className="text-[10px] text-yellow-400">{locationWarning}</p>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        <Row label="Equipment COGS" value={fmt(breakdown.cogs)} />
        <Row label="Labour" value={fmt(breakdown.labour)} />
        <Row label="Acquisition" value={fmt(breakdown.acquisition)} />
        <Row label="Fulfillment" value={fmt(breakdown.fulfillment)} />
        <Row label="Adders" value={fmt(breakdown.extraCosts + breakdown.fixedAdderTotal)} />
        <div className="col-span-2 border-t border-t-border my-1" />
        <Row label="Total Cost" value={fmt(breakdown.totalCosts)} bold />
        <Row label={`Markup (${breakdown.markupPct}%)`} value={fmt(breakdown.basePrice - breakdown.totalCosts)} />
        <div className="col-span-2 border-t border-t-border my-1" />
        <Row label="Calculated Price" value={fmt(breakdown.finalPrice)} bold />
      </div>

      <div className="rounded bg-surface-2/80 p-2">
        <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
          <Row label="PPW (price/watt)" value={`$${ppw.toFixed(2)}/W`} />
          <Row label="System Size" value={`${(breakdown.totalWatts / 1000).toFixed(1)} kW`} />
        </div>
      </div>

      <div className={`rounded border p-2 ${deltaBg}`}>
        <div className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs ${deltaColor}`}>
          <Row label="Calculator" value={fmt(breakdown.finalPrice)} />
          <Row label="HubSpot Deal" value={item.dealAmount ? fmt(item.dealAmount) : "N/A"} />
          <div className="col-span-2 border-t border-current/20 my-1" />
          <Row
            label="Delta"
            value={
              item.dealAmount
                ? `${delta >= 0 ? "+" : ""}${fmt(delta)} (${deltaPct!.toFixed(1)}%)`
                : "N/A"
            }
            bold
          />
        </div>
        {isPeTag && (
          <p className="text-[10px] mt-1.5 opacity-70">PE/org-level adders not included</p>
        )}
      </div>

      {unmatched.length > 0 && (
        <div className="text-[10px] text-yellow-400">
          <p className="font-medium">{unmatched.length} item{unmatched.length > 1 ? "s" : ""} not matched to pricing catalog:</p>
          <ul className="mt-0.5 list-disc list-inside">
            {unmatched.map((name, i) => <li key={i}>{name}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <>
      <span className={bold ? "font-semibold" : ""}>{label}</span>
      <span className={`text-right ${bold ? "font-semibold" : ""}`}>{value}</span>
    </>
  );
}
