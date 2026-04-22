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
        setPanelDelta(0); // reset manual delta after server reprice
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

  // Client-side panel +/- produces a rough price delta (labeled as an adjustment).
  const adjustedPanelCount = Math.max(4, result.panelCount + panelDelta);
  const adjustedKwDc = (adjustedPanelCount * panelWattage) / 1000;
  const adjustedRetail = baseFixed + perPanel * adjustedPanelCount + (result.pricing.addOnsUsd ?? 0);
  const adjustedFinal = Math.max(0, adjustedRetail * discountMultiplier);
  const adjustedDiscount = adjustedRetail - adjustedFinal;
  const monthlyProxy = estimateMonthlyPayment(adjustedFinal, result.pricing.finalUsd, result.pricing.monthlyPaymentUsd);
  const productionRatio = result.panelCount > 0 ? adjustedPanelCount / result.panelCount : 1;
  const adjustedAnnualKwh = result.annualProductionKwh * productionRatio;
  const adjustedOffset =
    result.annualConsumptionKwh > 0
      ? Math.min(100, (adjustedAnnualKwh / result.annualConsumptionKwh) * 100)
      : result.offsetPercent;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {firstName ? `${firstName}, here's your estimate` : "Your solar estimate"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          This is an instant estimate — not a final quote. A Photon Brothers advisor will refine
          the numbers after a quick consult.
        </p>
      </header>

      {/* Hero */}
      <section className="rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Metric label="System size" value={`${adjustedKwDc.toFixed(2)} kW`} />
          <Metric
            label="Panels"
            value={String(adjustedPanelCount)}
            action={
              <div className="mt-2 inline-flex overflow-hidden rounded-md border border-t-border">
                <button
                  type="button"
                  onClick={() => setPanelDelta((d) => d - 1)}
                  disabled={adjustedPanelCount <= 4}
                  className="bg-surface-2 px-3 py-1 text-sm hover:bg-surface-elevated disabled:opacity-40"
                  aria-label="Remove panel"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setPanelDelta((d) => d + 1)}
                  className="bg-surface-2 px-3 py-1 text-sm hover:bg-surface-elevated"
                  aria-label="Add panel"
                >
                  +
                </button>
              </div>
            }
          />
          <Metric label="Offset" value={`${Math.round(adjustedOffset)}%`} />
          <Metric
            label="Annual production"
            value={`${Math.round(adjustedAnnualKwh).toLocaleString()} kWh`}
          />
        </div>
      </section>

      {/* Price */}
      <section className="mt-6 rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <Row label="Retail system price" value={formatUsd(adjustedRetail)} />
          {result.pricing.breakdown.lineItems.map((li) => (
            <Row key={li.label} label={li.label} value={`+ ${formatUsd(li.amountUsd)}`} muted />
          ))}
          <Row
            label="Incentives & discounts applied"
            value={`− ${formatUsd(adjustedDiscount)}`}
            muted
          />
          <div className="my-1 border-t border-t-border" />
          <Row label="Estimated final price" value={formatUsd(adjustedFinal)} bold />
          <Row
            label="Estimated monthly payment"
            value={`${formatUsd(monthlyProxy)}/mo`}
            muted
          />
        </dl>
        {repricing && <p className="mt-3 text-xs text-muted">Updating pricing…</p>}
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
      </section>

      {/* Add-ons */}
      <section className="mt-6 rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
        <h2 className="text-lg font-semibold">Add-ons</h2>
        <p className="mt-1 text-sm text-muted">Toggle to update your estimate.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AddOnToggle
            label="Level-2 EV charger"
            checked={addOns.evCharger}
            onChange={() => toggleAddOn("evCharger")}
          />
          <AddOnToggle
            label="Main panel upgrade"
            checked={addOns.panelUpgrade}
            onChange={() => toggleAddOn("panelUpgrade")}
          />
        </div>
      </section>

      {/* Assumptions */}
      <section className="mt-6 rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
        <h2 className="text-lg font-semibold">Assumptions</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
          {result.assumptions.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-t-border bg-surface-2 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h3 className="text-lg font-semibold">Ready to talk to a real person?</h3>
          <p className="mt-1 text-sm text-muted">
            Book a free consult — we&apos;ll refine your estimate with actual roof measurements and
            production modeling.
          </p>
        </div>
        <a
          href="https://www.photonbrothers.com/free-solar-estimate"
          className="rounded-lg bg-orange-500 px-5 py-2.5 text-sm font-medium text-white shadow-card hover:bg-orange-600"
        >
          Schedule Consultation
        </a>
      </section>
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

function Metric({
  label,
  value,
  action,
}: {
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {action}
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
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
      <dt className={`${muted ? "text-muted" : "text-foreground"} ${bold ? "font-semibold" : ""}`} title={tooltip}>
        {label}
      </dt>
      <dd className={bold ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}

function AddOnToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition ${
        checked
          ? "border-orange-500 bg-orange-500/10"
          : "border-t-border bg-surface-2 hover:border-foreground/30"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-orange-500"
      />
      <span>{label}</span>
    </label>
  );
}
