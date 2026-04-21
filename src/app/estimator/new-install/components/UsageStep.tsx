"use client";

import { useMemo, useState, type Dispatch } from "react";

import type { RoofType, ShadeBucket, Usage } from "@/lib/estimator";

import type { WizardAction, WizardState } from "../state";
import StepLayout from "./StepLayout";
import UtilityFallback from "./UtilityFallback";

type Props = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  onBack: () => void;
  onContinue: () => void;
};

const ROOF_OPTIONS: Array<{ value: RoofType; label: string }> = [
  { value: "asphalt_shingle", label: "Asphalt shingle" },
  { value: "tile", label: "Tile" },
  { value: "metal", label: "Metal" },
  { value: "flat_tpo", label: "Flat / TPO" },
  { value: "other", label: "Other" },
];

const SHADE_OPTIONS: Array<{ value: ShadeBucket; label: string; desc: string }> = [
  { value: "light", label: "Light", desc: "Few obstructions; roof gets full sun most of the day." },
  { value: "moderate", label: "Moderate", desc: "Some trees or neighboring buildings cast shade." },
  { value: "heavy", label: "Heavy", desc: "Significant shading from nearby trees or structures." },
];

export default function UsageStep({ state, dispatch, onBack, onContinue }: Props) {
  const [showFallback, setShowFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialUsage: Usage =
    state.usage ?? { kind: "kwh", avgMonthlyKwh: 0 };
  const [usageKind, setUsageKind] = useState<Usage["kind"]>(initialUsage.kind);
  const [kwh, setKwh] = useState<string>(
    initialUsage.kind === "kwh" && initialUsage.avgMonthlyKwh > 0
      ? String(initialUsage.avgMonthlyKwh)
      : "",
  );
  const [bill, setBill] = useState<string>(
    initialUsage.kind === "bill" && initialUsage.avgMonthlyBillUsd > 0
      ? String(initialUsage.avgMonthlyBillUsd)
      : "",
  );

  const selectedUtility = useMemo(
    () => state.utilities.find((u) => u.id === state.utilityId) ?? null,
    [state.utilities, state.utilityId],
  );

  function buildUsage(): Usage | null {
    if (usageKind === "kwh") {
      const n = Number(kwh);
      if (!Number.isFinite(n) || n <= 0) return null;
      return { kind: "kwh", avgMonthlyKwh: n };
    }
    const n = Number(bill);
    if (!Number.isFinite(n) || n <= 0) return null;
    return { kind: "bill", avgMonthlyBillUsd: n };
  }

  function handleContinue(): void {
    const usage = buildUsage();
    if (!usage) {
      setError("Please enter your monthly usage.");
      return;
    }
    if (!state.utilityId) {
      setError("Please select your utility provider.");
      return;
    }
    if (!state.roofType) {
      setError("Please select your roof type.");
      return;
    }
    if (!state.shade) {
      setError("Please select your shade level.");
      return;
    }
    if (state.heatPump === null) {
      setError("Please indicate whether you have a heat pump.");
      return;
    }
    setError(null);
    dispatch({ type: "setUsage", usage });
    onContinue();
  }

  if (showFallback && state.normalizedAddress && state.location) {
    return (
      <UtilityFallback
        address={state.normalizedAddress}
        location={state.location}
        onBack={() => setShowFallback(false)}
      />
    );
  }

  return (
    <StepLayout
      title="Tell us about your home"
      subtitle="We'll use this to size a system that fits."
      onBack={onBack}
      footer={
        <>
          <button
            type="button"
            onClick={handleContinue}
            className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-orange-600"
          >
            Continue
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Utility */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="utility">
            Utility provider
          </label>
          <select
            id="utility"
            value={state.utilityId ?? ""}
            onChange={(e) => dispatch({ type: "setUtility", utilityId: e.target.value })}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
          >
            <option value="" disabled>
              Select your utility…
            </option>
            {state.utilities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setShowFallback(true)}
            className="self-start text-xs text-muted underline hover:text-foreground"
          >
            Don't see your provider?
          </button>
        </div>

        {/* Usage */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Monthly electricity usage</label>
          <div className="inline-flex w-fit overflow-hidden rounded-lg border border-t-border bg-surface-2 text-sm">
            <button
              type="button"
              onClick={() => setUsageKind("kwh")}
              className={`px-4 py-2 ${
                usageKind === "kwh" ? "bg-orange-500 text-white" : "text-muted hover:text-foreground"
              }`}
            >
              kWh / month
            </button>
            <button
              type="button"
              onClick={() => setUsageKind("bill")}
              className={`px-4 py-2 ${
                usageKind === "bill" ? "bg-orange-500 text-white" : "text-muted hover:text-foreground"
              }`}
            >
              Bill $ / month
            </button>
          </div>
          {usageKind === "kwh" ? (
            <input
              type="number"
              inputMode="decimal"
              min={0}
              placeholder="e.g. 900"
              value={kwh}
              onChange={(e) => setKwh(e.target.value)}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
            />
          ) : (
            <div className="flex flex-col gap-1">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="e.g. 180"
                value={bill}
                onChange={(e) => setBill(e.target.value)}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
              />
              <p className="text-xs text-muted">
                We&apos;ll estimate your kWh using
                {selectedUtility
                  ? ` ${selectedUtility.displayName}'s avg blended rate of $${selectedUtility.avgBlendedRateUsdPerKwh.toFixed(2)}/kWh.`
                  : " your utility's average blended rate."}
              </p>
            </div>
          )}
        </div>

        {/* Roof type */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="roof">
            Roof type
          </label>
          <select
            id="roof"
            value={state.roofType ?? ""}
            onChange={(e) =>
              dispatch({ type: "setRoofType", value: e.target.value as RoofType })
            }
            className="w-full rounded-lg border border-t-border bg-surface-2 px-4 py-2.5 text-sm outline-none focus:border-orange-500"
          >
            <option value="" disabled>
              Select roof type…
            </option>
            {ROOF_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {/* Shade */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Shade on your roof</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SHADE_OPTIONS.map((o) => {
              const active = state.shade === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => dispatch({ type: "setShade", value: o.value })}
                  className={`rounded-lg border px-3 py-3 text-left text-sm transition ${
                    active
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-t-border bg-surface-2 hover:border-foreground/30"
                  }`}
                >
                  <div className="font-medium">{o.label}</div>
                  <div className="mt-1 text-xs text-muted">{o.desc}</div>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Heat pump */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Do you have (or plan to install) a heat pump?</legend>
          <div className="flex gap-2">
            {[
              { label: "Yes", value: true },
              { label: "No", value: false },
            ].map((o) => {
              const active = state.heatPump === o.value;
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => dispatch({ type: "setHeatPump", value: o.value })}
                  className={`rounded-lg border px-4 py-2 text-sm transition ${
                    active
                      ? "border-orange-500 bg-orange-500/10"
                      : "border-t-border bg-surface-2 hover:border-foreground/30"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Considerations */}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Anything else we should know?</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ConsiderationCheck
              checked={state.considerations.planningEv}
              onChange={(v) =>
                dispatch({
                  type: "setConsiderations",
                  value: { ...state.considerations, planningEv: v },
                })
              }
              label="Planning to get an EV"
              help="We'll size an extra ~3,500 kWh/yr to cover typical EV charging."
            />
            <ConsiderationCheck
              checked={state.considerations.needsPanelUpgrade}
              onChange={(v) =>
                dispatch({
                  type: "setConsiderations",
                  value: { ...state.considerations, needsPanelUpgrade: v },
                })
              }
              label="Main panel likely needs upgrade"
              help="Older 100A panels often need an upgrade before solar — we'll include this in pricing."
            />
            <ConsiderationCheck
              checked={state.considerations.planningHotTub}
              onChange={(v) =>
                dispatch({
                  type: "setConsiderations",
                  value: { ...state.considerations, planningHotTub: v },
                })
              }
              label="Adding a hot tub or spa"
              help="We'll add ~2,500 kWh/yr to your usage estimate."
            />
            <ConsiderationCheck
              checked={state.considerations.mayNeedNewRoof}
              onChange={(v) =>
                dispatch({
                  type: "setConsiderations",
                  value: { ...state.considerations, mayNeedNewRoof: v },
                })
              }
              label="Roof may need replacement soon"
              help="We can bundle roofing with your solar install — we'll reach out to discuss."
            />
          </div>
        </fieldset>
      </div>
    </StepLayout>
  );
}

function ConsiderationCheck({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-t-border bg-surface-2 p-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{help}</span>
      </span>
    </label>
  );
}
