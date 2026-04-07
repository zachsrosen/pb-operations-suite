"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { IdrItem } from "./IdrMeetingClient";

interface Props {
  item: IdrItem;
  onChange: (updates: Partial<IdrItem>) => void;
  readOnly: boolean;
}

/**
 * DA Status Actions — toggles that change the HubSpot layout_status on sync:
 *  - Sales Change Requested → "Pending Sales Changes" + sales_communication_reason
 *  - Needs Survey Info → "Pending Ops Changes" + ops_communication_reason
 *  - Needs Resurvey → "Pending Resurvey" + ops_communication_reason
 */
export function StatusActionsForm({ item, onChange, readOnly }: Props) {
  const handleToggle = useCallback(
    (field: keyof IdrItem) => {
      onChange({ [field]: !(item[field] as boolean | null | undefined) } as Partial<IdrItem>);
    },
    [onChange, item],
  );

  const handleText = useCallback(
    (field: keyof IdrItem, value: string) => {
      onChange({ [field]: value } as Partial<IdrItem>);
    },
    [onChange],
  );

  // Determine which status will be set on sync
  const activeStatus = item.needsResurvey
    ? "Pending Resurvey"
    : item.needsSurveyInfo
      ? "Pending Ops Changes"
      : item.salesChangeRequested
        ? "Pending Sales Changes"
        : null;

  return (
    <div className="space-y-2">
      {/* Active status indicator */}
      {activeStatus && (
        <div className="rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-500">
            On sync: {activeStatus}
          </p>
        </div>
      )}

      {/* Toggle rows — compact inline layout */}
      <div className="space-y-2">
        {/* Sales Change */}
        <div>
          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={!!item.salesChangeRequested}
              onChange={() => handleToggle("salesChangeRequested")}
              disabled={readOnly}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Sales Change</span>
          </div>
          {item.salesChangeRequested && (
            <CompactTextarea
              value={item.salesChangeNotes ?? ""}
              onChange={(val) => handleText("salesChangeNotes", val)}
              readOnly={readOnly}
              placeholder="Sales communication reason (required)..."
            />
          )}
        </div>

        {/* Needs Survey Info */}
        <div>
          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={!!item.needsSurveyInfo}
              onChange={() => handleToggle("needsSurveyInfo")}
              disabled={readOnly}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Needs Survey Info</span>
          </div>
          {item.needsSurveyInfo && (
            <CompactTextarea
              value={item.opsChangeNotes ?? ""}
              onChange={(val) => handleText("opsChangeNotes", val)}
              readOnly={readOnly}
              placeholder="Ops communication reason (required)..."
            />
          )}
        </div>

        {/* Needs Resurvey */}
        <div>
          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={!!item.needsResurvey}
              onChange={() => handleToggle("needsResurvey")}
              disabled={readOnly}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Needs Resurvey</span>
          </div>
          {item.needsResurvey && (
            <CompactTextarea
              value={item.opsChangeNotes ?? ""}
              onChange={(val) => handleText("opsChangeNotes", val)}
              readOnly={readOnly}
              placeholder="Ops communication reason (required)..."
            />
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-t-border my-1" />

        {/* Shit Show — flag for the Shit Show meeting */}
        <div>
          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={!!item.shitShowFlagged}
              onChange={() => handleToggle("shitShowFlagged")}
              disabled={readOnly}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              🔥 Add to Shit Show Meeting
            </span>
          </div>
          {item.shitShowFlagged && (
            <CompactTextarea
              value={item.shitShowReason ?? ""}
              onChange={(val) => handleText("shitShowReason", val)}
              readOnly={readOnly}
              placeholder="Why is this a shit show? (optional)..."
            />
          )}
          {item.shitShowFlagged && (
            <p className="text-[10px] text-red-400 mt-0.5">
              Will appear in the next Shit Show meeting for discussion.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-orange-500" : "bg-surface-2 border border-t-border"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function CompactTextarea({
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [local, setLocal] = useState(value);
  const focusedRef = useRef(false);

  // Sync external value when not focused
  useEffect(() => {
    if (!focusedRef.current) setLocal(value);
  }, [value]);

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
    <textarea
      ref={ref}
      rows={1}
      value={local}
      onChange={handleInput}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => { focusedRef.current = false; }}
      disabled={readOnly}
      className="w-full mt-1 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground resize-none disabled:opacity-50 placeholder:text-muted"
      placeholder={readOnly ? "" : placeholder}
    />
  );
}
