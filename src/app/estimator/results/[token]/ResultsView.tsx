"use client";

import { useCallback, useMemo, useState } from "react";

import type { EstimatorInput, EstimatorResult, QuoteRequest } from "@/lib/estimator";

type Props = {
  token: string;
  firstName: string | null;
  initialInput: EstimatorInput;
  initialResult: EstimatorResult;
};

export default function ResultsView({ firstName, initialInput, initialResult }: Props) {
  const [result, setResult] = useState<EstimatorResult>(initialResult);
  const [addOns, setAddOns] = useState({
    evCharger: initialInput.addOns.evCharger,
    panelUpgrade: initialInput.addOns.panelUpgrade,
  });
  const [panelDelta, setPanelDelta] = useState(0);
  const [repricing, setRepricing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const panelWattage = initialInput.pricing.panelOutput;
  const perPanel = initialInput.pricing.perPanel;
  const baseFixed = initialInput.pricing.base;
  const discountMultiplier = initialInput.pricing.discountMultiplier;

  const quoteRequestFromInput = useMemo<QuoteRequest>(
    () => ({
      address: initialInput.address,
      location: initialInput.location,
      utilityId: initialInput.utility.id,
      usage: initialInput.usage,
      home: initialInput.home,
      considerations: initialInput.considerations,
      addOns,
    }),
    [initialInput, addOns],
  );

  const reQuote = useCallback(
    async (nextAddOns: typeof addOns) => {
      setRepricing(true);
      setError(null);
      try {
        const res = await fetch("/api/estimator/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...quoteRequestFromInput, addOns: nextAddOns }),
        });
        if (!res.ok) {
          setError("Could not update pricing. Please try again.");
          return;
        }
        const data = (await res.json()) as { result: EstimatorResult };
        setResult(data.result);
        setPanelDelta(0);
      } catch (err) {
        console.error(err);
        setError("Network error. Please try again.");
      } finally {
        setRepricing(false);
      }
    },
    [quoteRequestFromInput],
  );

  const toggleAddOn = useCallback(
    (key: keyof typeof addOns) => {
      const next = { ...addOns, [key]: !addOns[key] };
      setAddOns(next);
      void reQuote(next);
    },
    [addOns, reQuote],
  );

  const adjustedPanelCount = Math.max(4, result.panelCount + panelDelta);
  const adjustedKwDc = (adjustedPanelCount * panelWattage) / 1000;
  const adjustedRetail = baseFixed + perPanel * adjustedPanelCount + (result.pricing.addOnsUsd ?? 0);
  const adjustedFinal = Math.max(0, adjustedRetail * discountMultiplier);
  const adjustedDiscount = adjustedRetail - adjustedFinal;
  const monthlyProxy = estimateMonthlyPayment(
    adjustedFinal,
    result.pricing.finalUsd,
    result.pricing.monthlyPaymentUsd,
  );
  const productionRatio = result.panelCount > 0 ? adjustedPanelCount / result.panelCount : 1;
  const adjustedAnnualKwh = result.annualProductionKwh * productionRatio;
  const adjustedOffset =
    result.annualConsumptionKwh > 0
      ? Math.min(100, (adjustedAnnualKwh / result.annualConsumptionKwh) * 100)
      : result.offsetPercent;

  return (
    <div className="relative">
      {/* Ambient success glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[380px] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(249,115,22,0.18), transparent 70%)",
        }}
      />

      <div className="relative mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 text-center sm:mb-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Estimate ready
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            {firstName ? `${firstName}, here's your estimate.` : "Your solar estimate."}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            This is instant — a Photon Brothers advisor will refine the numbers with real roof
            measurements and production modeling during your free consult.
          </p>
        </header>

        {/* Hero metrics */}
        <section className="relative overflow-hidden rounded-3xl border border-t-border bg-surface p-6 shadow-card-lg sm:p-10">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-500"
          />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <HeroMetric label="System size" value={`${adjustedKwDc.toFixed(2)}`} unit="kW" />
            <HeroMetric
              label="Panels"
              value={String(adjustedPanelCount)}
              action={
                <div className="mt-3 inline-flex overflow-hidden rounded-lg border border-t-border">
                  <button
                    type="button"
                    onClick={() => setPanelDelta((d) => d - 1)}
                    disabled={adjustedPanelCount <= 4}
                    className="bg-surface-2 px-3 py-1.5 text-sm font-medium transition hover:bg-surface-elevated disabled:opacity-40"
                    aria-label="Remove panel"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelDelta((d) => d + 1)}
                    className="bg-surface-2 px-3 py-1.5 text-sm font-medium transition hover:bg-surface-elevated"
                    aria-label="Add panel"
                  >
                    +
                  </button>
                </div>
              }
            />
            <HeroMetric label="Energy offset" value={`${Math.round(adjustedOffset)}`} unit="%" />
            <HeroMetric
              label="Annual production"
              value={`${Math.round(adjustedAnnualKwh).toLocaleString()}`}
              unit="kWh"
            />
          </div>
        </section>

        {/* Price + add-ons */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          <section className="rounded-3xl border border-t-border bg-surface p-6 shadow-card sm:p-8 lg:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Your price</h2>
              {repricing && <span className="text-xs text-muted">Updating…</span>}
            </div>
            <dl className="mt-5 flex flex-col gap-2.5 text-sm">
              <Row label="Retail system price" value={formatUsd(adjustedRetail)} />
              {result.pricing.breakdown.lineItems.map((li) => (
                <Row key={li.label} label={li.label} value={`+ ${formatUsd(li.amountUsd)}`} muted />
              ))}
              <Row
                label="Incentives & discounts"
                value={`− ${formatUsd(adjustedDiscount)}`}
                muted
              />
              <div className="my-2 border-t border-t-border" />
              <div className="flex items-end justify-between gap-2 pt-1">
                <dt className="text-sm font-semibold">Estimated final price</dt>
                <dd className="text-3xl font-bold tracking-tight text-orange-500">
                  {formatUsd(adjustedFinal)}
                </dd>
              </div>
              {monthlyProxy > 0 && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-xs text-muted">Or finance it</dt>
                  <dd className="text-sm font-medium text-muted">
                    from{" "}
                    <span className="font-semibold text-foreground">{formatUsd(monthlyProxy)}</span>
                    /mo
                  </dd>
                </div>
              )}
            </dl>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
          </section>

          <section className="rounded-3xl border border-t-border bg-surface p-6 shadow-card sm:p-8 lg:col-span-2">
            <h2 className="text-lg font-semibold">Add-ons</h2>
            <p className="mt-1 text-sm text-muted">Toggle to update your price.</p>
            <div className="mt-4 flex flex-col gap-2.5">
              <AddOnToggle
                label="Level-2 EV charger"
                sublabel="Home charging at 40A"
                checked={addOns.evCharger}
                onChange={() => toggleAddOn("evCharger")}
              />
              <AddOnToggle
                label="Main panel upgrade"
                sublabel="For older 100A panels"
                checked={addOns.panelUpgrade}
                onChange={() => toggleAddOn("panelUpgrade")}
              />
            </div>
          </section>
        </div>

        {/* What's next timeline */}
        <section className="mt-6 rounded-3xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
          <h2 className="text-lg font-semibold">What happens next</h2>
          <ol className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <TimelineStep
              step={1}
              title="Free consult"
              description="A Photon Brothers advisor calls to refine your estimate and answer questions."
              accent="orange"
              active
            />
            <TimelineStep
              step={2}
              title="Custom design"
              description="Our engineers produce a stamped plan with real roof measurements and production modeling."
              accent="amber"
            />
            <TimelineStep
              step={3}
              title="Install & turn on"
              description="Our in-house crews install and commission your system — typically within 30–60 days."
              accent="emerald"
            />
          </ol>
        </section>

        {/* Assumptions */}
        <section className="mt-6 rounded-3xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
          <details className="group">
            <summary className="flex cursor-pointer items-center justify-between gap-2 text-lg font-semibold">
              <span>How we calculated this</span>
              <span className="text-sm text-muted transition group-open:rotate-180">▾</span>
            </summary>
            <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
              {result.assumptions.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </details>
        </section>

        {/* CTA */}
        <section className="mt-8 overflow-hidden rounded-3xl border border-orange-500/30 bg-gradient-to-br from-orange-500/15 via-surface to-surface p-6 shadow-card-lg sm:p-10">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Ready to talk to a real person?
              </h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
                Book a free, no-pressure consult. We&apos;ll lock in your incentives and walk you
                through the design.
              </p>
            </div>
            <a
              href="https://www.photonbrothers.com/free-solar-estimate"
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-xl bg-orange-500 px-7 py-4 text-base font-semibold text-white shadow-card-lg transition hover:-translate-y-0.5 hover:bg-orange-600"
            >
              Schedule consultation
              <span aria-hidden>→</span>
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function estimateMonthlyPayment(
  adjustedFinal: number,
  origFinal: number,
  origMonthly: number,
): number {
  if (origFinal <= 0) return 0;
  return (origMonthly * adjustedFinal) / origFinal;
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function HeroMetric({
  label,
  value,
  unit,
  action,
}: {
  label: string;
  value: string;
  unit?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight sm:text-4xl">{value}</span>
        {unit && <span className="text-base font-medium text-muted">{unit}</span>}
      </div>
      {action}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  tooltip,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  tooltip?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={muted ? "text-muted" : "text-foreground"} title={tooltip}>
        {label}
      </dt>
      <dd className={muted ? "text-muted" : "font-medium"}>{value}</dd>
    </div>
  );
}

function AddOnToggle({
  label,
  sublabel,
  checked,
  onChange,
}: {
  label: string;
  sublabel?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 text-sm transition ${
        checked
          ? "border-orange-500 bg-orange-500/10 ring-1 ring-orange-500/30"
          : "border-t-border bg-surface-2 hover:border-foreground/30"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 shrink-0 accent-orange-500"
      />
      <span className="flex flex-1 flex-col gap-0.5">
        <span className="font-semibold">{label}</span>
        {sublabel && <span className="text-xs text-muted">{sublabel}</span>}
      </span>
    </label>
  );
}

function TimelineStep({
  step,
  title,
  description,
  accent,
  active,
}: {
  step: number;
  title: string;
  description: string;
  accent: "orange" | "amber" | "emerald";
  active?: boolean;
}) {
  const accentColor =
    accent === "orange"
      ? "from-orange-500/30 to-orange-500/5 text-orange-400 ring-orange-500/40"
      : accent === "amber"
        ? "from-amber-500/25 to-amber-500/5 text-amber-400 ring-amber-500/40"
        : "from-emerald-500/25 to-emerald-500/5 text-emerald-400 ring-emerald-500/40";
  return (
    <li className="relative flex flex-col gap-2">
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br ring-1 ring-inset text-sm font-bold ${accentColor}`}
      >
        {step}
      </div>
      <h3 className="text-sm font-semibold">
        {title}
        {active && (
          <span className="ml-2 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-orange-400">
            Up next
          </span>
        )}
      </h3>
      <p className="text-xs leading-relaxed text-muted">{description}</p>
    </li>
  );
}
