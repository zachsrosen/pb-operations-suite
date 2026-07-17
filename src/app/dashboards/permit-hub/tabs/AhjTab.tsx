import type { AHJRecord } from "@/lib/hubspot-custom-objects";

/**
 * The AHJ turnaround properties are HubSpot calculation_rollup numbers held in
 * MILLISECONDS, so rendering them raw showed things like "489135483.870968"
 * where a number of days was meant. The object's own `permit_turnaround_average`
 * text field corroborates the conversion — Arvada 2002560000ms = 23.2d vs "24",
 * Aurora 705600000ms = 8.2d vs "8", Atascadero 5085257142ms = 58.9d vs "59".
 *
 * Returns null for blank/zero so the field renders "—" rather than "0.0 days"
 * (a real case: AHJs with no permits in the window roll up to 0).
 */
function formatMsAsDays(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const days = ms / 86_400_000;
  return `${days.toFixed(1)} days`;
}

/** Rollup averages carry full float precision (e.g. 0.329032). */
function formatAverage(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function AhjTab({ ahj }: { ahj: AHJRecord[] }) {
  if (!ahj.length) {
    return (
      <div className="text-muted text-sm">
        No AHJ record associated with this deal.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {ahj.map((record) => {
        const p = record.properties as Record<string, string | null | undefined>;
        return (
          <div key={record.id} className="rounded-lg border border-t-border p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">
                  {p.record_name ?? "Unnamed AHJ"}
                </h3>
                <div className="text-muted text-xs">
                  {[p.city, p.county, p.state].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="flex gap-2">
                {p.portal_link && (
                  <a
                    href={p.portal_link}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-blue-500 px-3 py-1 text-xs font-medium text-white hover:bg-blue-600"
                  >
                    Portal
                  </a>
                )}
                {p.application_link && (
                  <a
                    href={p.application_link}
                    target="_blank"
                    rel="noreferrer"
                    className="bg-surface-2 rounded-md px-3 py-1 text-xs font-medium"
                  >
                    Application
                  </a>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <Field label="Submission method" value={p.submission_method} />
              <Field
                label="Avg turnaround (365d)"
                value={formatMsAsDays(p.average_permit_turnaround_time__365_days_)}
              />
              <Field label="Primary contact" value={p.primary_contact_name} />
              <Field label="Contact email" value={p.email} />
              <Field label="Contact phone" value={p.phone_number} />
              <Field label="Stamping required" value={p.stamping_requirements} />
              <Field
                label="Customer signature req"
                value={p.customer_signature_required_on_permit}
              />
              <Field label="Permits issued" value={p.permit_issued_count} />
              <Field label="Rejections" value={p.permit_rejection_count} />
              <Field
                label="Avg revisions"
                value={formatAverage(p.average_permit_revision_count)}
              />
            </dl>
            {p.permit_issues && (
              <div className="mt-4 rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <strong>Known issues:</strong> {p.permit_issues}
              </div>
            )}
            {p.general_notes && (
              <div className="text-muted mt-2 text-xs">
                <strong>Notes:</strong> {p.general_notes}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-muted text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5">
        {value != null && value !== "" ? String(value) : "—"}
      </dd>
    </div>
  );
}
