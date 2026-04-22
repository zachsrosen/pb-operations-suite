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

const ROOF_OPTIONS: Array<{ value: RoofType; label: string; glyph: string }> = [
  { value: "asphalt_shingle", label: "Asphalt shingle", glyph: "▦" },
  { value: "tile", label: "Tile", glyph: "▨" },
  { value: "metal", label: "Metal", glyph: "▤" },
  { value: "flat_tpo", label: "Flat / TPO", glyph: "▭" },
  { value: "other", label: "Other", glyph: "?" },
];

const SHADE_OPTIONS: Array<{ value: ShadeBucket; label: string; desc: string; icon: React.ReactNode }> = [
  {
    value: "light",
    label: "Light",
    desc: "Mostly sunny — few obstructions.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </svg>
    ),
  },
  {
    value: "moderate",
    label: "Moderate",
    desc: "Some trees or buildings cast shade.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16a5 5 0 0 1 4.5-5A6 6 0 0 1 20 13.5a3.5 3.5 0 0 1-.2 7H7a3 3 0 0 1-3-4.5z" />
      </svg>
    ),
  },
  {
    value: "heavy",
    label: "Heavy",
    desc: "Lots of shade from trees or structures.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2v6M7 8l3 2M17 8l-3 2M4 12l4 1M20 12l-4 1M7 20l2-3M17 20l-2-3M12 22v-6" />
      </svg>
    ),
  },
];

export default function UsageStep({ state, dispatch, onBack, onContinue }: Props) {
  const [showFallback, setShowFallback] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialUsage: Usage = state.usage ?? { kind: "kwh", avgMonthlyKwh: 0 };
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
      eyebrow="Your home"
      title="Tell us a bit more."
      subtitle="A few quick details so we can size the right system and price it accurately."
      onBack={onBack}
      footer={
        <>
          <button
            type="button"
            onClick={handleContinue}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-card transition hover:-translate-y-0.5 hover:bg-orange-600 hover:shadow-card-lg"
          >
            Continue
            <span aria-hidden>→</span>
          </button>
          {error && <span className="text-sm text-red-500">{error}</span>}
        </>
      }
    >
      <div className="flex flex-col gap-8">
        {/* GROUP: Utility */}
        <Group number="1" title="Your utility">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="utility">
              Electric utility
            </label>
            <div className="relative">
              <select
                id="utility"
                value={state.utilityId ?? ""}
                onChange={(e) => dispatch({ type: "setUtility", utilityId: e.target.value })}
                className="w-full appearance-none rounded-xl border border-t-border bg-surface-2 px-4 py-3 pr-10 text-sm outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
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
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted">
                ▾
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowFallback(true)}
              className="self-start text-xs font-medium text-muted underline-offset-4 hover:text-foreground hover:underline"
            >
              Don&apos;t see your provider?
            </button>
          </div>
        </Group>

        {/* GROUP: Usage */}
        <Group number="2" title="Your electricity usage">
          <div className="flex flex-col gap-3">
            <div className="inline-flex w-fit overflow-hidden rounded-xl border border-t-border bg-surface-2 p-1 text-sm">
              <button
                type="button"
                onClick={() => setUsageKind("kwh")}
                className={`rounded-lg px-4 py-2 font-medium transition ${
                  usageKind === "kwh"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                kWh / month
              </button>
              <button
                type="button"
                onClick={() => setUsageKind("bill")}
                className={`rounded-lg px-4 py-2 font-medium transition ${
                  usageKind === "bill"
                    ? "bg-orange-500 text-white shadow-sm"
                    : "text-muted hover:text-foreground"
                }`}
              >
                Bill $ / month
              </button>
            </div>
            {usageKind === "kwh" ? (
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="900"
                  value={kwh}
                  onChange={(e) => setKwh(e.target.value)}
                  className="w-full rounded-xl border border-t-border bg-surface-2 px-4 py-3 pr-16 text-base outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">
                  kWh
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted">
                    $
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    placeholder="180"
                    value={bill}
                    onChange={(e) => setBill(e.target.value)}
                    className="w-full rounded-xl border border-t-border bg-surface-2 py-3 pl-8 pr-16 text-base outline-none transition focus:border-orange-500 focus:bg-surface-elevated focus:ring-2 focus:ring-orange-500/20"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">
                    / mo
                  </span>
                </div>
                <p className="text-xs text-muted">
                  We&apos;ll estimate your kWh using
                  {selectedUtility
                    ? ` ${selectedUtility.displayName}'s avg blended rate of $${selectedUtility.kwhRate.toFixed(2)}/kWh.`
                    : " your utility's average blended rate."}
                </p>
              </div>
            )}
          </div>
        </Group>

        {/* GROUP: Home details */}
        <Group number="3" title="Your roof">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Roof material</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {ROOF_OPTIONS.map((o) => {
                  const active = state.roofType === o.value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => dispatch({ type: "setRoofType", value: o.value })}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-center transition ${
                        active
                          ? "border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/30"
                          : "border-t-border bg-surface-2 hover:border-foreground/30"
                      }`}
                    >
                      <span className={`text-2xl leading-none ${active ? "text-orange-500" : "text-muted"}`}>
                        {o.glyph}
                      </span>
                      <span className="text-xs font-medium">{o.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

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
                      className={`flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition ${
                        active
                          ? "border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/30"
                          : "border-t-border bg-surface-2 hover:border-foreground/30"
                      }`}
                    >
                      <span className={`mt-0.5 ${active ? "text-orange-500" : "text-muted"}`}>
                        {o.icon}
                      </span>
                      <span className="flex flex-col gap-0.5">
                        <span className="text-sm font-semibold">{o.label}</span>
                        <span className="text-xs text-muted">{o.desc}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>
        </Group>

        {/* GROUP: Heat pump + considerations */}
        <Group number="4" title="A few extras">
          <div className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">
                Do you have (or plan to install) a heat pump?
              </legend>
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
                      className={`min-w-[6rem] rounded-xl border px-5 py-2.5 text-sm font-medium transition ${
                        active
                          ? "border-orange-500 bg-orange-500/10 text-orange-400 ring-2 ring-orange-500/30"
                          : "border-t-border bg-surface-2 hover:border-foreground/30"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>

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
        </Group>
      </div>
    </StepLayout>
  );
}

function Group({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500/15 text-xs font-bold text-orange-500"
        >
          {number}
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{title}</h2>
      </div>
      <div className="pl-0 sm:pl-10">{children}</div>
    </section>
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
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
        checked
          ? "border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/30"
          : "border-t-border bg-surface-2 hover:border-foreground/30"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-xs leading-relaxed text-muted">{help}</span>
      </span>
    </label>
  );
}
