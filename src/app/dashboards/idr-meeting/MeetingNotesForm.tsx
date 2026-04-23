"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { IdrItem } from "./IdrMeetingClient";

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

const NOTE_FIELDS: { key: keyof IdrItem; label: string }[] = [
  { key: "customerNotes", label: "Customer Notes" },
  { key: "operationsNotes", label: "Operations Notes" },
  { key: "designNotes", label: "Design Notes" },
  { key: "conclusion", label: "Conclusion" },
];

export function MeetingNotesForm({ item, onChange, readOnly }: Props) {
  const handleChange = useCallback(
    (field: keyof IdrItem, value: string) => {
      onChange({ [field]: value } as Partial<IdrItem>);
    },
    [onChange],
  );

  return (
    <div className="space-y-2">
      {/* Escalation reason (read-only display) */}
      {item.type === "ESCALATION" && item.escalationReason && (
        <div className="rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-500 mb-0.5">
            Escalation Reason
          </p>
          <p className="text-xs text-foreground">{item.escalationReason}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {NOTE_FIELDS.map(({ key, label }) => (
          <div key={`${item.id}-${key}`}>
            <LocalTextarea
              label={label}
              externalValue={(item[key] as string | null) ?? ""}
              onChange={(val) => handleChange(key, val)}
              readOnly={readOnly}
            />
            {key === "customerNotes" && item.customerNotes && item.customerNotes.trim() && (
              <label className="mt-1 flex items-center gap-1.5 text-[10px] text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={item.customerNotesCreateTask}
                  onChange={(e) =>
                    onChange({ customerNotesCreateTask: e.target.checked })
                  }
                  disabled={readOnly}
                  className="h-3 w-3 accent-orange-500"
                />
                <span>
                  Create task for PM on sync
                  {item.customerNotesCreateTask && (
                    <span className="ml-1 text-orange-500">· enabled</span>
                  )}
                </span>
              </label>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local-state textarea — keeps its own value to avoid per-keystroke
// React Query cache updates. Syncs back to parent on change (debounced
// upstream) and accepts external value updates when not focused.
// ---------------------------------------------------------------------------

function LocalTextarea({
  label,
  externalValue,
  onChange,
  readOnly,
}: {
  label: string;
  externalValue: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [local, setLocal] = useState(externalValue);
  const focusedRef = useRef(false);

  // Sync external value in when not focused (e.g. SSE update, item switch)
  useEffect(() => {
    if (!focusedRef.current) setLocal(externalValue);
  }, [externalValue]);

  // Auto-resize — only on local state change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [local]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocal(v);
    onChange(v);
  };

  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-muted block mb-0.5">
        {label}
      </label>
      <textarea
        ref={ref}
        rows={1}
        value={local}
        onChange={handleInput}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={() => { focusedRef.current = false; }}
        disabled={readOnly}
        className="w-full rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground resize-none disabled:opacity-50 placeholder:text-muted"
        placeholder={readOnly ? "" : `${label.toLowerCase()}...`}
      />
    </div>
  );
}
