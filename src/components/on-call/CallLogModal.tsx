"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import {
  ESCALATION_TARGETS,
  ISSUE_TYPES,
  computeHoursWorked,
} from "@/lib/on-call-call-log";

type Pool = { id: string; name: string; isActive: boolean };

type CrewMemberRef = { id: string; name: string };

/**
 * Modal shell — handles visibility + click-out. The form body lives in
 * CallLogForm so each open mounts fresh state (no reset effects needed).
 */
export function CallLogModal({
  open,
  onClose,
  crewMember,
  activeCrewMembers,
  defaultPoolId,
}: {
  open: boolean;
  onClose: () => void;
  crewMember: CrewMemberRef | null;
  activeCrewMembers?: CrewMemberRef[];
  defaultPoolId?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-t-border rounded-xl shadow-card w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-surface border-b border-t-border px-5 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Log a call</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground text-sm"
          >
            ✕
          </button>
        </div>
        <CallLogForm
          crewMember={crewMember}
          activeCrewMembers={activeCrewMembers}
          defaultPoolId={defaultPoolId}
          onClose={onClose}
        />
      </div>
    </div>
  );
}

function CallLogForm({
  crewMember,
  activeCrewMembers,
  defaultPoolId,
  onClose,
}: {
  crewMember: CrewMemberRef | null;
  activeCrewMembers?: CrewMemberRef[];
  defaultPoolId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  // Pool list — most electricians are in one pool, but allow choosing.
  const poolsQ = useQuery<{ pools: Pool[] }>({
    queryKey: queryKeys.onCall.pools(),
    queryFn: async () => {
      const res = await fetch("/api/on-call/pools");
      if (!res.ok) throw new Error("Failed to load pools");
      return res.json();
    },
  });
  const activePools = useMemo(
    () => (poolsQ.data?.pools ?? []).filter((p) => p.isActive),
    [poolsQ.data?.pools],
  );

  // Pool selection: lazy-init with caller's default; fall back to first active pool
  // once pools load. Computed via useMemo of activePools, falling through state
  // when the user explicitly picks a different one.
  const [poolIdOverride, setPoolIdOverride] = useState<string | null>(null);
  const poolId =
    poolIdOverride ??
    (defaultPoolId && activePools.some((p) => p.id === defaultPoolId)
      ? defaultPoolId
      : activePools[0]?.id ?? "");

  // Time call received — defaults to "now" in the browser tz on first render.
  const [callReceivedAt, setCallReceivedAt] = useState<string>(() => nowLocalDatetimeStr());

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [issueType, setIssueType] = useState<string>(ISSUE_TYPES[0].value);
  const [safetyRisk, setSafetyRisk] = useState(false);
  const [homeHasPower, setHomeHasPower] = useState<"yes" | "no" | "unknown">("unknown");
  const [troubleshootingAttempted, setTroubleshootingAttempted] = useState("");
  const [outcome, setOutcome] = useState<"resolved" | "dispatched" | "follow-up" | null>(null);
  const [arrivalAt, setArrivalAt] = useState("");
  const [completedAt, setCompletedAt] = useState("");
  const [escalatedToChoice, setEscalatedToChoice] = useState<string>("");
  const [escalatedToOther, setEscalatedToOther] = useState("");
  const [notes, setNotes] = useState("");
  const [pickedCrewMemberId, setPickedCrewMemberId] = useState("");
  const [issueTypeOther, setIssueTypeOther] = useState("");
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const reporterId = crewMember?.id ?? pickedCrewMemberId;

  const resolvedRemotely = outcome === "resolved";
  const dispatched = outcome === "dispatched";
  const hoursPreview = dispatched
    ? computeHoursWorked(localToIso(arrivalAt), localToIso(completedAt))
    : null;

  const escalatedTo: string | null = (() => {
    if (!escalatedToChoice) return null;
    if (escalatedToChoice === "Other") return escalatedToOther.trim() || null;
    return escalatedToChoice;
  })();

  function chooseOutcome(value: "resolved" | "dispatched" | "follow-up") {
    setOutcome(value);
    if (value === "dispatched") {
      const now = nowLocalDatetimeStr();
      setArrivalAt((prev) => prev || callReceivedAt || now);
      setCompletedAt((prev) => prev || now);
    }
  }

  const submit = useMutation({
    mutationFn: async () => {
      const body = {
        poolId,
        reporterCrewMemberId: reporterId,
        callReceivedAt: localToIso(callReceivedAt),
        customerName,
        customerPhone: customerPhone.trim() || null,
        customerAddress: customerAddress.trim() || null,
        issueType,
        issueTypeOther: issueType === "other" ? issueTypeOther.trim() : null,
        safetyRisk,
        homeHasPower:
          homeHasPower === "yes" ? true : homeHasPower === "no" ? false : null,
        troubleshootingAttempted: troubleshootingAttempted || null,
        resolvedRemotely,
        dispatched,
        arrivalAt: dispatched ? localToIso(arrivalAt) : null,
        completedAt: dispatched ? localToIso(completedAt) : null,
        escalatedTo,
        notes: notes || null,
      };
      const res = await fetch("/api/on-call/call-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      const json: { error?: string } = text ? JSON.parse(text) : {};
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.onCall.root });
      onClose();
    },
    onError: (e: Error) => setSubmitErr(e.message),
  });

  const canSubmit =
    Boolean(reporterId) &&
    Boolean(poolId) &&
    callReceivedAt.length > 0 &&
    customerName.trim().length > 0 &&
    issueType.length > 0 &&
    (issueType !== "other" || issueTypeOther.trim().length > 0) &&
    outcome !== null &&
    !submit.isPending;

  return (
    <form
      className="p-5 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) submit.mutate();
      }}
    >
      {submitErr && (
        <div className="text-sm rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 px-3 py-2">
          {submitErr}
        </div>
      )}

      {!crewMember && activeCrewMembers && activeCrewMembers.length > 0 && (
        <Field label="Who took the call?">
          <select
            value={pickedCrewMemberId}
            onChange={(e) => setPickedCrewMemberId(e.target.value)}
            className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            required
          >
            <option value="">— Select electrician —</option>
            {activeCrewMembers.map((cm) => (
              <option key={cm.id} value={cm.id}>
                {cm.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!crewMember && (!activeCrewMembers || activeCrewMembers.length === 0) && (
        <div className="text-sm rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 px-3 py-2">
          No active crew members are available to assign this call.
        </div>
      )}

      {/* Pool — only show selector if user has more than one option */}
      {activePools.length > 1 ? (
        <Field label="Pool">
          <select
            value={poolId}
            onChange={(e) => setPoolIdOverride(e.target.value)}
            className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            required
          >
            {activePools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label="Time call received">
        <input
          type="datetime-local"
          value={callReceivedAt}
          onChange={(e) => setCallReceivedAt(e.target.value)}
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
          required
        />
      </Field>

      <Field label="Customer name">
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="e.g. John Smith"
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
          required
        />
      </Field>

      <Field label="Customer phone">
        <input
          type="tel"
          value={customerPhone}
          onChange={(e) => setCustomerPhone(e.target.value)}
          placeholder="e.g. (303) 555-1234"
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Customer address (optional)">
        <input
          type="text"
          value={customerAddress}
          onChange={(e) => setCustomerAddress(e.target.value)}
          placeholder="e.g. 1234 Main St, Denver, CO 80202"
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Issue type">
        <select
          value={issueType}
          onChange={(e) => setIssueType(e.target.value)}
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
          required
        >
          {ISSUE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      {issueType === "other" && (
        <Field label="Describe the issue">
          <input
            type="text"
            value={issueTypeOther}
            onChange={(e) => setIssueTypeOther(e.target.value)}
            placeholder="e.g. Panel access issue, tree fell on array"
            className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
            required
          />
        </Field>
      )}

      <ToggleField
        label="Safety risk?"
        value={safetyRisk}
        onChange={setSafetyRisk}
      />

      <Field label="Home has power?">
        <div className="flex gap-2">
          <ChipChoice
            active={homeHasPower === "yes"}
            onClick={() => setHomeHasPower("yes")}
          >
            Yes
          </ChipChoice>
          <ChipChoice
            active={homeHasPower === "no"}
            onClick={() => setHomeHasPower("no")}
          >
            No
          </ChipChoice>
          <ChipChoice
            active={homeHasPower === "unknown"}
            onClick={() => setHomeHasPower("unknown")}
          >
            Didn&apos;t ask
          </ChipChoice>
        </div>
      </Field>

      <Field label="Troubleshooting attempted">
        <textarea
          value={troubleshootingAttempted}
          onChange={(e) => setTroubleshootingAttempted(e.target.value)}
          rows={2}
          placeholder="e.g. Reset inverter, checked breakers"
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm resize-none"
        />
      </Field>

      <Field label="Outcome">
        <div className="flex gap-2 flex-wrap">
          <ChipChoice
            active={outcome === "resolved"}
            onClick={() => chooseOutcome("resolved")}
          >
            Resolved remotely
          </ChipChoice>
          <ChipChoice
            active={outcome === "dispatched"}
            onClick={() => chooseOutcome("dispatched")}
          >
            Dispatched
          </ChipChoice>
          <ChipChoice
            active={outcome === "follow-up"}
            onClick={() => chooseOutcome("follow-up")}
          >
            Follow-up needed
          </ChipChoice>
        </div>
      </Field>

      {dispatched && (
        <div className="bg-surface-2 border border-t-border rounded p-3 space-y-3">
          <div className="text-xs uppercase tracking-wide text-muted">Dispatch</div>
          <Field label="Arrival time">
            <input
              type="datetime-local"
              value={arrivalAt}
              onChange={(e) => setArrivalAt(e.target.value)}
              className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Completion time">
            <input
              type="datetime-local"
              value={completedAt}
              onChange={(e) => setCompletedAt(e.target.value)}
              className="w-full bg-surface border border-t-border rounded px-3 py-2 text-sm"
            />
          </Field>
          <div className="text-xs text-muted">
            Hours worked: <strong className="text-foreground">{hoursPreview ?? "—"}</strong>
            <span className="opacity-70"> (auto-calculated)</span>
          </div>
        </div>
      )}

      <Field label="Escalated to (optional)">
        <select
          value={escalatedToChoice}
          onChange={(e) => setEscalatedToChoice(e.target.value)}
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
        >
          <option value="">— Not escalated —</option>
          {ESCALATION_TARGETS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {escalatedToChoice === "Other" && (
          <input
            type="text"
            value={escalatedToOther}
            onChange={(e) => setEscalatedToOther(e.target.value)}
            placeholder="Who did you escalate to?"
            className="mt-2 w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm"
          />
        )}
      </Field>

      <Field label="Notes (optional)">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything else worth recording"
          className="w-full bg-surface-2 border border-t-border rounded px-3 py-2 text-sm resize-none"
        />
      </Field>

      <div className="flex gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 rounded border border-t-border text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex-1 px-4 py-2 rounded bg-orange-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {submit.isPending ? "Saving…" : "Save call log"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-muted mb-1">{label}</div>
      {children}
    </label>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        <ChipChoice active={value === true} onClick={() => onChange(true)}>
          Yes
        </ChipChoice>
        <ChipChoice active={value === false} onClick={() => onChange(false)}>
          No
        </ChipChoice>
      </div>
    </Field>
  );
}

function ChipChoice({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-sm border transition ${
        active
          ? "bg-orange-500/20 border-orange-500/60 text-orange-200"
          : "bg-surface-2 border-t-border text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

/** Returns "YYYY-MM-DDTHH:mm" in the *browser's* local time zone for datetime-local. */
function nowLocalDatetimeStr(): string {
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60_000;
  const local = new Date(d.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

/** Convert datetime-local string ("YYYY-MM-DDTHH:mm" in browser tz) to a full ISO string. */
function localToIso(s: string): string {
  if (!s) return "";
  return new Date(s).toISOString();
}
