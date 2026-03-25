"use client";

import { useState, useMemo, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { StatCard, MetricCard } from "@/components/ui/MetricCard";
import {
  calcPrice,
  EQUIPMENT_CATALOG,
  PRICING_SCHEMES,
  ROOF_TYPES,
  STOREY_ADDERS,
  PITCH_ADDERS,
  ORG_ADDERS,
  PE_LEASE,
  type CalcInput,
  type EquipmentSelection,
} from "@/lib/pricing-calculator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

function fmtShort(n: number): string {
  if (Math.abs(n) >= 1000) {
    return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return fmt(n);
}

const modules = EQUIPMENT_CATALOG.filter((e) => e.category === "module");
const inverters = EQUIPMENT_CATALOG.filter((e) => e.category === "inverter");
const batteries = EQUIPMENT_CATALOG.filter((e) => e.category === "battery");
const otherEquip = EQUIPMENT_CATALOG.filter((e) => e.category === "other");

// ---------------------------------------------------------------------------
// Equipment row component
// ---------------------------------------------------------------------------

function EquipRow({
  label,
  qty,
  costPerUnit,
  onChange,
  onRemove,
}: {
  label: string;
  qty: number;
  costPerUnit: number;
  onChange: (qty: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <button onClick={onRemove} className="text-red-400 hover:text-red-300 text-sm font-mono">
        ✕
      </button>
      <span className="text-sm text-foreground flex-1 min-w-0 truncate">{label}</span>
      <span className="text-xs text-muted whitespace-nowrap">@ {fmt(costPerUnit)}</span>
      <input
        type="number"
        min={0}
        value={qty}
        onChange={(e) => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-16 px-2 py-1 rounded bg-surface-2 border border-border text-foreground text-sm text-center"
      />
      <span className="text-sm text-muted w-20 text-right">{fmt(costPerUnit * qty)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equipment section component
// ---------------------------------------------------------------------------

function EquipSection({
  title,
  catalog,
  selections,
  setSelections,
}: {
  title: string;
  catalog: typeof modules;
  selections: EquipmentSelection[];
  setSelections: (s: EquipmentSelection[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const addItem = (code: string) => {
    if (selections.some((s) => s.code === code)) return;
    setSelections([...selections, { code, qty: 1 }]);
    setAdding(false);
  };

  const updateQty = (idx: number, qty: number) => {
    const next = [...selections];
    next[idx] = { ...next[idx], qty };
    setSelections(next);
  };

  const removeItem = (idx: number) => {
    setSelections(selections.filter((_, i) => i !== idx));
  };

  const available = catalog.filter((c) => !selections.some((s) => s.code === c.code));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-foreground">{title}</h4>
        {available.length > 0 && (
          <button
            onClick={() => setAdding(!adding)}
            className="text-xs text-orange-400 hover:text-orange-300"
          >
            {adding ? "Cancel" : "+ Add"}
          </button>
        )}
      </div>

      {adding && (
        <select
          className="w-full mb-2 px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
          value=""
          onChange={(e) => e.target.value && addItem(e.target.value)}
        >
          <option value="">Select {title.toLowerCase()}...</option>
          {available.map((eq) => (
            <option key={eq.code} value={eq.code}>
              {eq.label} — {fmt(eq.costPerUnit)}
              {eq.wattsPerUnit ? ` (${eq.wattsPerUnit}W)` : ""}
            </option>
          ))}
        </select>
      )}

      {selections.length === 0 ? (
        <p className="text-xs text-muted italic">None selected</p>
      ) : (
        selections.map((sel, i) => {
          const eq = EQUIPMENT_CATALOG.find((e) => e.code === sel.code);
          if (!eq) return null;
          return (
            <EquipRow
              key={sel.code}
              label={eq.label}
              qty={sel.qty}
              costPerUnit={eq.costPerUnit}
              onChange={(qty) => updateQty(i, qty)}
              onRemove={() => removeItem(i)}
            />
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PricingCalculatorPage() {
  // Equipment state
  const [modSel, setModSel] = useState<EquipmentSelection[]>([
    { code: "HiN-T440NF(BK)", qty: 20 },
  ]);
  const [invSel, setInvSel] = useState<EquipmentSelection[]>([]);
  const [batSel, setBatSel] = useState<EquipmentSelection[]>([]);
  const [othSel, setOthSel] = useState<EquipmentSelection[]>([]);

  // Pricing & site
  const [schemeId, setSchemeId] = useState("base");
  const [roofId, setRoofId] = useState("comp");
  const [storeyId, setStoreyId] = useState("1");
  const [pitchId, setPitchId] = useState("none");
  const [pitchWattsOverride, setPitchWattsOverride] = useState<string>("");

  // Adders
  const [activeAdders, setActiveAdders] = useState<string[]>(["pe"]);
  const [customAdder, setCustomAdder] = useState(0);
  const [energyCommunity, setEnergyCommunity] = useState(false);

  // Energy Community auto-check
  const [ecZip, setEcZip] = useState("");
  const [ecLoading, setEcLoading] = useState(false);
  const [ecResult, setEcResult] = useState<{
    isEnergyCommunity: boolean;
    matchedAddress?: string;
    coalClosure?: { hit: boolean; details?: string };
    statisticalArea?: { hit: boolean; details?: string };
  } | null>(null);
  const [ecError, setEcError] = useState<string | null>(null);

  const checkEnergyCommunity = useCallback(async (zip: string) => {
    if (!/^\d{5}$/.test(zip)) return;
    setEcLoading(true);
    setEcError(null);
    setEcResult(null);
    try {
      const res = await fetch(`/api/energy-community/check?zip=${zip}`);
      const data = await res.json();
      if (!res.ok) {
        setEcError(data.error ?? "Lookup failed");
        return;
      }
      setEcResult(data);
      setEnergyCommunity(data.isEnergyCommunity);
    } catch {
      setEcError("Network error — check failed");
    } finally {
      setEcLoading(false);
    }
  }, []);

  const toggleAdder = (id: string) => {
    setActiveAdders((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  };

  // Calculate
  const input: CalcInput = useMemo(
    () => ({
      modules: modSel,
      inverters: invSel,
      batteries: batSel,
      otherEquip: othSel,
      pricingSchemeId: schemeId,
      roofTypeId: roofId,
      storeyId,
      pitchId,
      pitchWatts: pitchWattsOverride ? parseInt(pitchWattsOverride) || undefined : undefined,
      activeAdderIds: activeAdders,
      customFixedAdder: customAdder,
      energyCommunity,
    }),
    [modSel, invSel, batSel, othSel, schemeId, roofId, storeyId, pitchId, pitchWattsOverride, activeAdders, customAdder, energyCommunity]
  );

  const result = useMemo(() => calcPrice(input), [input]);

  const ppw = result.totalWatts > 0 ? result.finalPrice / result.totalWatts : 0;

  return (
    <DashboardShell title="Pricing Calculator" accentColor="orange">
      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 stagger-grid">
        <StatCard
          key={String(result.finalPrice)}
          label={result.peActive ? "Customer Price (PE)" : "System Price"}
          value={fmt(result.finalPrice)}
          color="orange"
        />
        <StatCard
          key={String(result.hsAmount)}
          label="HubSpot Amount"
          value={fmt(result.hsAmount)}
          subtitle={result.peActive ? "Full PB revenue" : undefined}
          color="blue"
        />
        <StatCard
          key={String(result.totalCosts)}
          label="Total COGS"
          value={fmt(result.totalCosts)}
          color="red"
        />
        <StatCard
          key={String(ppw)}
          label="Price / Watt"
          value={result.totalWatts > 0 ? `$${ppw.toFixed(2)}` : "—"}
          subtitle={result.totalWatts > 0 ? `${(result.totalWatts / 1000).toFixed(2)} kW system` : undefined}
          color="emerald"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Equipment & Settings */}
        <div className="lg:col-span-1 space-y-6">
          {/* Equipment Card */}
          <div className="bg-surface rounded-lg border border-border p-4 shadow-card space-y-5">
            <h3 className="text-base font-semibold text-foreground">Equipment</h3>
            <EquipSection title="Modules" catalog={modules} selections={modSel} setSelections={setModSel} />
            <EquipSection title="Inverters" catalog={inverters} selections={invSel} setSelections={setInvSel} />
            <EquipSection title="Batteries" catalog={batteries} selections={batSel} setSelections={setBatSel} />
            <EquipSection title="Other" catalog={otherEquip} selections={othSel} setSelections={setOthSel} />
          </div>

          {/* Site & Pricing Card */}
          <div className="bg-surface rounded-lg border border-border p-4 shadow-card space-y-4">
            <h3 className="text-base font-semibold text-foreground">Site & Pricing</h3>

            <div>
              <label className="text-xs text-muted block mb-1">Pricing Scheme</label>
              <select
                value={schemeId}
                onChange={(e) => setSchemeId(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
              >
                {PRICING_SCHEMES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} ({s.markupPct}%)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted block mb-1">Roof Type</label>
              <select
                value={roofId}
                onChange={(e) => setRoofId(e.target.value)}
                className="w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
              >
                {ROOF_TYPES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                    {r.costPerWatt > 0 ? ` (+$${r.costPerWatt}/W)` : ""}
                    {r.costPerSystem > 0 ? ` (+$${r.costPerSystem.toLocaleString()}/sys)` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">Stories</label>
                <select
                  value={storeyId}
                  onChange={(e) => setStoreyId(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
                >
                  {STOREY_ADDERS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                      {s.costPerWatt > 0 ? ` (+$${s.costPerWatt}/W)` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted block mb-1">Roof Pitch</label>
                <select
                  value={pitchId}
                  onChange={(e) => setPitchId(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
                >
                  {PITCH_ADDERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.costPerWatt > 0 ? ` (+$${p.costPerWatt}/W)` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {pitchId !== "none" && (
              <div>
                <label className="text-xs text-muted block mb-1">
                  Watts on steep pitch{" "}
                  <span className="text-muted/60">(blank = all {result.totalWatts.toLocaleString()}W)</span>
                </label>
                <input
                  type="number"
                  min={0}
                  max={result.totalWatts}
                  placeholder={String(result.totalWatts)}
                  value={pitchWattsOverride}
                  onChange={(e) => setPitchWattsOverride(e.target.value)}
                  className="w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
                />
              </div>
            )}
          </div>

          {/* Adders Card */}
          <div className="bg-surface rounded-lg border border-border p-4 shadow-card space-y-3">
            <h3 className="text-base font-semibold text-foreground">Adders & Discounts</h3>

            {ORG_ADDERS.map((adder) => (
              <label key={adder.id} className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={activeAdders.includes(adder.id)}
                  onChange={() => toggleAdder(adder.id)}
                  className="rounded border-border accent-orange-500"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-foreground">{adder.label}</span>
                  <span className="text-xs text-muted ml-2">
                    {adder.type === "percentage"
                      ? `${adder.value}%`
                      : fmt(adder.value)}
                  </span>
                </div>
              </label>
            ))}

            {activeAdders.includes("pe") && (
              <div className="pl-6 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="Zip code"
                    value={ecZip}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 5);
                      setEcZip(v);
                      if (v.length === 5) checkEnergyCommunity(v);
                    }}
                    className="w-24 px-2 py-1 rounded bg-surface-2 border border-border text-foreground text-sm"
                  />
                  <span className="text-xs text-muted flex items-center gap-1.5">
                    {ecLoading && (
                      <span className="inline-block w-3 h-3 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    )}
                    {!ecLoading && ecResult && (
                      ecResult.isEnergyCommunity
                        ? <span className="text-emerald-400">Energy Community</span>
                        : <span className="text-muted">Not an Energy Community</span>
                    )}
                    {!ecLoading && ecError && <span className="text-red-400">{ecError}</span>}
                    {!ecLoading && !ecResult && !ecError && "IRA bonus zone check"}
                  </span>
                </div>
                {ecResult && ecResult.isEnergyCommunity && (
                  <div className="text-xs text-muted space-y-0.5">
                    {ecResult.coalClosure?.hit && (
                      <div className="text-emerald-400/80">Coal Closure: {ecResult.coalClosure.details}</div>
                    )}
                    {ecResult.statisticalArea?.hit && (
                      <div className="text-emerald-400/80">Statistical Area: {ecResult.statisticalArea.details}</div>
                    )}
                  </div>
                )}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={energyCommunity}
                    onChange={() => setEnergyCommunity(!energyCommunity)}
                    className="rounded border-border accent-orange-500"
                  />
                  <span className="text-xs text-muted">Override EC status manually</span>
                </label>
              </div>
            )}

            <div className="pt-2 border-t border-border">
              <label className="text-xs text-muted block mb-1">Custom Fixed Adder ($)</label>
              <input
                type="number"
                value={customAdder || ""}
                onChange={(e) => setCustomAdder(parseFloat(e.target.value) || 0)}
                placeholder="e.g. -500"
                className="w-full px-2 py-1.5 rounded bg-surface-2 border border-border text-foreground text-sm"
              />
            </div>
          </div>
        </div>

        {/* RIGHT: COGS Breakdown */}
        <div className="lg:col-span-2 space-y-4">
          {/* COGS Section */}
          <div className="bg-surface rounded-lg border border-border p-5 shadow-card">
            <h3 className="text-base font-semibold text-foreground mb-4">Cost Breakdown</h3>

            <div className="space-y-4">
              {/* COGS */}
              <BreakdownSection
                title="COGS"
                total={result.cogs}
                rows={[
                  { label: "Modules", value: result.moduleCost },
                  { label: "Inverters", value: result.inverterCost },
                  { label: "Batteries", value: result.batteryCost },
                  ...(result.batteryMisc > 0 ? [{ label: "Battery Misc", value: result.batteryMisc }] : []),
                  { label: "Other Components", value: result.otherCost },
                  { label: "Other (Racking, BOS)", value: result.racking + result.bos },
                ]}
              />

              {/* Labour */}
              <BreakdownSection
                title="Labour"
                total={result.labour}
                rows={[
                  { label: "Labour General", value: result.labourGeneral },
                  ...(result.labourBatteries > 0 ? [{ label: "Labour Batteries", value: result.labourBatteries }] : []),
                ]}
              />

              {/* Acquisition */}
              <BreakdownSection
                title="Acquisition Costs"
                total={result.acquisition}
                rows={[
                  { label: "Lead Gen", value: result.leadGen },
                  { label: "Salary", value: result.salary },
                  { label: "Commission (5%)", value: result.commission },
                  { label: "Presale Software", value: result.presale },
                ]}
              />

              {/* Fulfillment */}
              <BreakdownSection
                title="Fulfillment Costs"
                total={result.fulfillment}
                rows={[
                  { label: "PM + Design + Permit", value: result.fulfillment },
                ]}
              />

              {/* Extra Costs */}
              {result.extraCosts > 0 && (
                <BreakdownSection
                  title="Extra Costs (Roof/Site)"
                  total={result.extraCosts}
                  rows={[
                    ...(result.roofAdder > 0 ? [{ label: "Roof Type Adder", value: result.roofAdder }] : []),
                    ...(result.storeyAdder > 0 ? [{ label: "Storey Adder", value: result.storeyAdder }] : []),
                    ...(result.pitchAdder > 0 ? [{ label: "Pitch Adder", value: result.pitchAdder }] : []),
                  ]}
                />
              )}

              {/* Total COGS */}
              <div className="pt-3 border-t-2 border-orange-500/30 flex justify-between items-center">
                <span className="text-sm font-semibold text-orange-400">Total Costs (ex tax)</span>
                <span className="text-lg font-bold text-foreground">{fmt(result.totalCosts)}</span>
              </div>
            </div>
          </div>

          {/* Price Calculation */}
          <div className="bg-surface rounded-lg border border-border p-5 shadow-card">
            <h3 className="text-base font-semibold text-foreground mb-4">Price Calculation</h3>

            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Total Costs</span>
                <span className="text-foreground">{fmt(result.totalCosts)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">Markup @ {result.markupPct}%</span>
                <span className="text-foreground">+ {fmt(result.basePrice - result.totalCosts)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium border-t border-border pt-2">
                <span className="text-foreground">Base Price</span>
                <span className="text-foreground">{fmt(result.basePrice)}</span>
              </div>

              {/* Fixed adders */}
              {result.fixedAdderDetails.map((a, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-muted">{a.label}</span>
                  <span className={a.amount < 0 ? "text-red-400" : "text-emerald-400"}>
                    {a.amount < 0 ? "−" : "+"} {fmt(Math.abs(a.amount))}
                  </span>
                </div>
              ))}

              {/* PE */}
              {result.peActive && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted">
                    PE Agreement [{Math.abs(result.pePct)}%]
                  </span>
                  <span className="text-red-400">− {fmt(result.peAmount)}</span>
                </div>
              )}

              {/* Final prices */}
              <div className="pt-3 border-t-2 border-orange-500/30 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-orange-400">
                    {result.peActive ? "Customer Price" : "System Price"}
                  </span>
                  <span className="text-xl font-bold text-foreground">{fmt(result.finalPrice)}</span>
                </div>

                {result.peActive && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-blue-400">HubSpot Amount</span>
                    <span className="text-lg font-bold text-foreground">{fmt(result.hsAmount)}</span>
                  </div>
                )}

                {result.totalWatts > 0 && (
                  <div className="flex justify-between text-xs text-muted pt-1">
                    <span>Price per watt</span>
                    <span>${ppw.toFixed(2)}/W</span>
                  </div>
                )}

                {/* Margin */}
                <div className="flex justify-between text-xs text-muted">
                  <span>Margin</span>
                  <span className={result.finalPrice - result.totalCosts < 0 ? "text-red-400" : "text-emerald-400"}>
                    {fmt(result.finalPrice - result.totalCosts)} (
                    {result.totalCosts > 0
                      ? (((result.finalPrice - result.totalCosts) / result.totalCosts) * 100).toFixed(1)
                      : "0"}
                    %)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Reference */}
          <div className="bg-surface rounded-lg border border-border p-5 shadow-card">
            <h3 className="text-base font-semibold text-foreground mb-3">Rate Reference</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-xs text-muted">
              <div>Racking: $0.15/W</div>
              <div>BOS: $0.15/W</div>
              <div>Labour: $0.55/W</div>
              <div>Lead Gen: $300/sys + $0.10/W</div>
              <div>Salary: $100/sys</div>
              <div>Commission: 5% of COGS+Labour</div>
              <div>Presale: $0.01/W</div>
              <div>PM: $1,000/sys</div>
              <div>Design: $350/sys</div>
              <div>Permit: $500/sys</div>
              <div>PW3 Labour: $2,600/unit</div>
              <div>Exp Labour: $1,900/unit</div>
            </div>
          </div>
        </div>
      </div>

      {/* PE Lease Value Calculator */}
      {result.peActive && (
        <div className="mt-6 bg-surface rounded-lg border border-border p-5 shadow-card">
          <h3 className="text-base font-semibold text-foreground mb-4">PE Lease Value Calculator</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Left: Lease Factor Details */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted">Lease Factor Inputs</h4>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">System Type</span>
                  <span className="text-foreground capitalize">
                    {result.peSystemType === "solar+battery"
                      ? "Solar + Battery"
                      : result.peSystemType === "solar"
                        ? "Solar Only"
                        : "Battery Only"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Solar Domestic Content</span>
                  <span className={result.peSolarDC ? "text-emerald-400" : "text-muted"}>
                    {result.peSolarDC ? "Qualified" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Battery Domestic Content</span>
                  <span className={result.peBatteryDC ? "text-emerald-400" : "text-muted"}>
                    {result.peBatteryDC ? "Qualified" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Energy Community</span>
                  <span className={result.peEnergyCommunnity ? "text-emerald-400" : "text-muted"}>
                    {result.peEnergyCommunnity ? "Yes" : "No"}
                  </span>
                </div>

                <div className="pt-2 border-t border-border space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted">Baseline Factor</span>
                    <span className="text-foreground">{PE_LEASE.baselineFactor.toFixed(7)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Adjustment</span>
                    <span className={result.peLeaseAdjustment > 0 ? "text-emerald-400" : result.peLeaseAdjustment < 0 ? "text-red-400" : "text-muted"}>
                      {result.peLeaseAdjustment > 0 ? "+" : ""}{result.peLeaseAdjustment.toFixed(7)}
                    </span>
                  </div>
                  <div className="flex justify-between font-medium">
                    <span className="text-foreground">Final Lease Factor</span>
                    <span className="text-foreground">{result.peLeaseFactor.toFixed(7)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Payment Breakdown */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted">Payment Breakdown</h4>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted">EPC Price (HubSpot Amount)</span>
                  <span className="text-foreground">{fmt(result.hsAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">÷ Lease Factor ({result.peLeaseFactor.toFixed(7)})</span>
                  <span className="text-foreground" />
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted">PE Customer Share (EPC ÷ Factor)</span>
                    <span className="text-foreground">{fmt(result.peLeaseCustomerAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-blue-400 font-medium">PE Pays PB</span>
                    <span className="text-foreground font-semibold">{fmt(result.pePaymentToInstaller)}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">@ Inspection Complete (2/3)</span>
                    <span className="text-foreground">{fmt(result.pePaymentIC)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted">@ Project Complete (1/3)</span>
                    <span className="text-foreground">{fmt(result.pePaymentPC)}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-400 font-medium">Customer Pays (flat 30% off)</span>
                    <span className="text-foreground font-semibold">{fmt(result.finalPrice)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-blue-400 font-medium">+ PE Pays PB</span>
                    <span className="text-foreground font-semibold">{fmt(result.pePaymentToInstaller)}</span>
                  </div>
                  <div className="flex justify-between font-medium pt-1 border-t border-border">
                    <span className="text-emerald-400">Total PB Revenue</span>
                    <span className="text-foreground font-semibold">{fmt(result.peTotalRevenue)}</span>
                  </div>
                  {Math.abs(result.peTotalRevenue - result.hsAmount) > 1 && (
                    <div className="text-xs text-muted">
                      {result.peTotalRevenue > result.hsAmount
                        ? `+${fmt(result.peTotalRevenue - result.hsAmount)} above EPC (DC/EC bonus)`
                        : `${fmt(result.peTotalRevenue - result.hsAmount)} below EPC (no-bonus penalty)`}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Breakdown section component
// ---------------------------------------------------------------------------

function BreakdownSection({
  title,
  total,
  rows,
}: {
  title: string;
  total: number;
  rows: { label: string; value: number }[];
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-sm font-semibold text-foreground">{fmt(total)}</span>
      </div>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between text-xs text-muted pl-3 py-0.5">
          <span>{r.label}</span>
          <span>{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
