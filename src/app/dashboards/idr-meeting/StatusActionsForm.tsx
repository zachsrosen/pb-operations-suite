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

  // Determine which layout_status will be set on sync
  const activeStatus = item.needsSurveyInfo
    ? "Pending Ops Changes"
    : item.salesChangeRequested
      ? "Pending Sales Changes"
      : null;

  // Design status is independent of layout_status
  const designAction = item.designRevisionNeeded
    ? "IDR Revision Needed"
    : null;

  return (
    <div className="space-y-2">
      {/* Active layout_status indicator */}
      {activeStatus && (
        <div className="rounded border border-orange-500/30 bg-orange-500/10 px-2 py-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-orange-500">
            On sync → approval status: {activeStatus}
          </p>
        </div>
      )}

      {/* Active design_status indicator */}
      {designAction && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500">
            On sync → design status: {designAction}
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
            <>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-muted">$</span>
                <input
                  type="number"
                  value={item.salesChangeAmount ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange({ salesChangeAmount: v === "" ? null : parseFloat(v) } as Partial<IdrItem>);
                  }}
                  disabled={readOnly}
                  className="w-32 rounded border border-t-border bg-surface-2 px-2 py-1 text-xs text-foreground disabled:opacity-50 placeholder:text-muted [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="Change amount"
                />
                {item.salesChangeAmount != null && item.dealAmount != null && item.dealAmount > 0 && (
                  <span className={`text-[10px] font-medium ${
                    (Math.abs(item.salesChangeAmount) / item.dealAmount) * 100 < 10
                      ? "text-yellow-400"
                      : "text-muted"
                  }`}>
                    {((Math.abs(item.salesChangeAmount) / item.dealAmount) * 100).toFixed(1)}% of project
                  </span>
                )}
              </div>
              {item.salesChangeAmount != null && item.dealAmount != null && item.dealAmount > 0 &&
                (Math.abs(item.salesChangeAmount) / item.dealAmount) * 100 < 10 && (
                <p className="text-[10px] text-yellow-400 mt-0.5">
                  ⚠ Under 10% of project cost — may be disqualified
                </p>
              )}
              <CompactTextarea
                value={item.salesChangeNotes ?? ""}
                onChange={(val) => handleText("salesChangeNotes", val)}
                readOnly={readOnly}
                placeholder="Sales communication reason (required)..."
              />
            </>
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

        {/* Design Revision Needed */}
        <div>
          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={!!item.designRevisionNeeded}
              onChange={() => handleToggle("designRevisionNeeded")}
              disabled={readOnly}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Design Revision Needed</span>
          </div>
          {item.designRevisionNeeded && (
            <CompactTextarea
              value={item.designRevisionReason ?? ""}
              onChange={(val) => handleText("designRevisionReason", val)}
              readOnly={readOnly}
              placeholder="Revision reason (required)..."
            />
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-t-border my-1" />

        {/* Shit Show — flag for the Shit Show meeting */}
        <div title="This flags the deal globally — clear it from the Shit Show meeting's Resolved action.">
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
