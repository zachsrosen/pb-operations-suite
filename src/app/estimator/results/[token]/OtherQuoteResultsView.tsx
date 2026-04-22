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
    "This is instant — a Photon Brothers advisor will confirm your service panel and install location.",
  battery:
    "This is instant — a Photon Brothers advisor will size your backup for the loads that matter most.",
  system_expansion:
    "This is instant — a Photon Brothers advisor will verify roof space and electrical capacity.",
};

export default function OtherQuoteResultsView({ firstName, quoteType, result }: Props) {
  const final = result.finalUsd ?? 0;
  const monthly = result.monthlyPaymentUsd ?? 0;
  const retail = result.retailUsd ?? 0;
  const discount = result.discountUsd ?? 0;
  const rebate = result.batteryRebateUsd ?? 0;
  const lineItems = result.lineItems ?? [];

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[380px] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(249,115,22,0.18), transparent 70%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 text-center sm:mb-10">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Estimate ready
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
            {firstName
              ? `${firstName}, ${TITLES[quoteType].toLowerCase()}.`
              : `${TITLES[quoteType]}.`}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted sm:text-base">
            {SUBTITLES[quoteType]}
          </p>
        </header>

        {quoteType === "system_expansion" && typeof result.panelCount === "number" && (
          <section className="relative overflow-hidden rounded-3xl border border-t-border bg-surface p-6 shadow-card-lg sm:p-10">
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-500"
            />
            <div className="grid grid-cols-2 gap-6">
              <HeroMetric label="Panels added" value={String(result.panelCount)} />
              <HeroMetric
                label="Added DC size"
                value={(result.systemKwDcAdded ?? 0).toFixed(2)}
                unit="kW"
              />
            </div>
          </section>
        )}

        <section
          className={`${
            quoteType === "system_expansion" ? "mt-6" : ""
          } relative overflow-hidden rounded-3xl border border-t-border bg-surface p-6 shadow-card sm:p-10`}
        >
          {quoteType !== "system_expansion" && (
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-500"
            />
          )}
          <h2 className="text-lg font-semibold">Your price</h2>
          <dl className="mt-5 flex flex-col gap-2.5 text-sm">
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
            <div className="my-2 border-t border-t-border" />
            <div className="flex items-end justify-between gap-2 pt-1">
              <dt className="text-sm font-semibold">Estimated final price</dt>
              <dd className="text-3xl font-bold tracking-tight text-orange-500">
                {formatUsd(final)}
              </dd>
            </div>
            {monthly > 0 && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-xs text-muted">Or finance it</dt>
                <dd className="text-sm font-medium text-muted">
                  from <span className="font-semibold text-foreground">{formatUsd(monthly)}</span>
                  /mo
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* What's next timeline */}
        <section className="mt-6 rounded-3xl border border-t-border bg-surface p-6 shadow-card sm:p-8">
          <h2 className="text-lg font-semibold">What happens next</h2>
          <ol className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <TimelineStep
              step={1}
              title="Free consult"
              description="An advisor calls to confirm details and answer any questions."
              accent="orange"
              active
            />
            <TimelineStep
              step={2}
              title="Plan & permit"
              description="We finalize the design, pull permits, and schedule install."
              accent="amber"
            />
            <TimelineStep
              step={3}
              title="Install"
              description="Our in-house crews handle the install and walk you through it."
              accent="emerald"
            />
          </ol>
        </section>

        <section className="mt-8 overflow-hidden rounded-3xl border border-orange-500/30 bg-gradient-to-br from-orange-500/15 via-surface to-surface p-6 shadow-card-lg sm:p-10">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <h3 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Ready to make it real?
              </h3>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted sm:text-base">
                We&apos;ll reach out to confirm the details and lock in your price.
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

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function HeroMetric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="flex flex-col">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tracking-tight sm:text-4xl">{value}</span>
        {unit && <span className="text-base font-medium text-muted">{unit}</span>}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className={muted ? "text-muted" : "text-foreground"}>{label}</dt>
      <dd className={muted ? "text-muted" : "font-medium"}>{value}</dd>
    </div>
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
