"use client";

type Props = {
  dealId: string;
  className?: string;
};

/**
 * Deal-detail embed: opens the mobile triage flow pre-populated with the
 * current deal. New tab keeps deal-detail state intact — a modal would need
 * to reproduce the entire stepper in-place.
 */
export default function TriageButton({ dealId, className }: Props) {
  const href = `/triage?dealId=${encodeURIComponent(dealId)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        className ??
        "flex w-full items-center gap-2 rounded bg-orange-500/15 px-2 py-1.5 text-xs font-medium text-orange-500 transition-colors hover:bg-orange-500/25"
      }
    >
      <span>🧭</span>
      Run triage
    </a>
  );
}
