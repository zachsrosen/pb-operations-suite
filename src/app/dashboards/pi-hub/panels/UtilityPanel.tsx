import type { UtilityRecord } from "@/lib/hubspot-custom-objects";

/**
 * Utility record panel. Ported from ic-hub's UtilityTab with the spec §6
 * cleanup: the `interconnection_turnaround_time`, `pto_turnaround_time`, and
 * `interconnection_issues` renders are dropped (those properties are never
 * populated / not on the object and not fetched), and the `submission_method`
 * render is corrected to `submission_type` (the real property name; the fetch
 * list uses submission_type).
 */
export function UtilityPanel({ records }: { records: UtilityRecord[] }) {
  if (!records.length) {
    return (
      <div className="text-muted text-sm">
        No utility record associated with this deal.
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {records.map((record) => {
        const p = record.properties as Record<string, string | null | undefined>;
        return (
          <div key={record.id} className="rounded-lg border border-t-border p-4">
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">
                  {p.utility_company_name ?? p.record_name ?? "Unnamed utility"}
                </h3>
                <div className="text-muted text-xs">
                  {[p.city, p.state].filter(Boolean).join(", ")}
                </div>
              </div>
              <div className="flex gap-2">
                {p.portal_link && (
                  <a
                    href={p.portal_link}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-green-500 px-3 py-1 text-xs font-medium text-white hover:bg-green-600"
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
              <Field label="Submission type" value={p.submission_type} />
              <Field label="Primary contact" value={p.primary_contact_name} />
              <Field label="Contact email" value={p.email} />
              <Field label="Contact phone" value={p.phone_number} />
            </dl>
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
