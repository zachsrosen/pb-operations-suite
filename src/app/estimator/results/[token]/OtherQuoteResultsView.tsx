"use client";

type LineItem = { label: string; amountUsd: number };

export type OtherQuoteResult = {
  retailUsd?: number;
  discountUsd?: number;
  batteryRebateUsd?: number;
  finalUsd?: number;
  monthlyPaymentUsd?: number;
  panelCount?: number;
  systemKwDcAdded?: number;
  lineItems?: LineItem[];
};

type Props = {
  firstName: string | null;
  quoteType: "ev_charger" | "battery" | "system_expansion";
  result: OtherQuoteResult;
};

const TITLES: Record<Props["quoteType"], string> = {
  ev_charger: "Your EV charger estimate",
  battery: "Your home backup battery estimate",
  system_expansion: "Your system expansion estimate",
};

const SUBTITLES: Record<Props["quoteType"], string> = {
  ev_charger:
    "This is an instant estimate — not a final quote. A Photon Brothers advisor will confirm site details.",
  battery:
    "This is an instant estimate — not a final quote. A Photon Brothers advisor will confirm battery sizing for your home.",
  system_expansion:
    "This is an instant estimate — not a final quote. A Photon Brothers advisor will verify roof space and electrical capacity.",
};

export default function OtherQuoteResultsView({ firstName, quoteType, result }: Props) {
  const final = result.finalUsd ?? 0;
  const monthly = result.monthlyPaymentUsd ?? 0;
  const retail = result.retailUsd ?? 0;
  const discount = result.discountUsd ?? 0;
  const rebate = result.batteryRebateUsd ?? 0;
  const lineItems = result.lineItems ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {firstName ? `${firstName}, ${TITLES[quoteType].toLowerCase()}` : TITLES[quoteType]}
        </h1>
        <p className="mt-1 text-sm text-muted">{SUBTITLES[quoteType]}</p>
      </header>

      {quoteType === "system_expansion" && typeof result.panelCount === "number" && (
        <section className="rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Metric label="Panels added" value={String(result.panelCount)} />
            <Metric
              label="Added DC system size"
              value={`${(result.systemKwDcAdded ?? 0).toFixed(2)} kW`}
            />
          </div>
        </section>
      )}

      <section
        className={`${
          quoteType === "system_expansion" ? "mt-6" : ""
        } rounded-2xl border border-t-border bg-surface p-6 shadow-card sm:p-8`}
      >
        <h2 className="text-lg font-semibold">Pricing</h2>
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          {lineItems.map((li) => (
            <Row key={li.label} label={li.label} value={formatUsd(li.amountUsd)} muted />
          ))}
          {retail > 0 && lineItems.length > 0 && (
            <>
              <div className="my-1 border-t border-t-border" />
              <Row label="Retail" value={formatUsd(retail)} />
            </>
          )}
          {discount > 0 && (
            <Row label="Incentives & discounts" value={`− ${formatUsd(discount)}`} muted />
          )}
          {rebate > 0 && (
            <Row label="Utility battery rebate" value={`− ${formatUsd(rebate)}`} muted />
          )}
          <div className="my-1 border-t border-t-border" />
          <Row label="Estimated final price" value={formatUsd(final)} bold />
          {monthly > 0 && (
            <Row label="Estimated monthly payment" value={`${formatUsd(monthly)}/mo`} muted />
          )}
        </dl>
      </section>

      <section className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-t-border bg-surface-2 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <h3 className="text-lg font-semibold">Ready to talk to a real person?</h3>
          <p className="mt-1 text-sm text-muted">
            We&apos;ll reach out to confirm the details and lock in your price.
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

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={`${muted ? "text-muted" : "text-foreground"} ${bold ? "font-semibold" : ""}`}>
        {label}
      </dt>
      <dd className={bold ? "font-semibold" : ""}>{value}</dd>
    </div>
  );
}
