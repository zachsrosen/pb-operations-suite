"use client";

import type { Dispatch, SetStateAction } from "react";
import type { LandingCard, RoleDefinition } from "@/lib/roles";
import {
  BADGE_COLOR_OPTIONS,
  SUITE_OPTIONS,
  SCOPE_VALUES,
  LABEL_MAX_LEN,
  DESCRIPTION_MAX_LEN,
  BADGE_ABBREV_MAX_LEN,
  LANDING_CARDS_MAX,
  type GuardViolation,
  type ScopeValue,
} from "@/lib/role-override-types";

/**
 * Subcomponents for RoleDefinitionEditor — split out of the parent to keep
 * the parent under the 500 LOC cap. Purely presentational; all state lives
 * in RoleDefinitionEditor and is threaded through via the SectionProps.
 */

// Re-export the form state shape used by the parent.
export interface FormState {
  label: { on: boolean; value: string };
  description: { on: boolean; value: string };
  visibleInPicker: { on: boolean; value: boolean };
  scope: { on: boolean; value: ScopeValue };
  badgeColor: { on: boolean; value: string };
  badgeAbbrev: { on: boolean; value: string };
  suites: { on: boolean; value: string[] };
  allowedRoutes: { on: boolean; value: string[] };
  landingCards: { on: boolean; value: LandingCard[] };
}

export interface SectionProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  codeDefaults: RoleDefinition;
  violationsByField: Map<GuardViolation["field"], string[]>;
  allKnownRoutes?: string[];
}

/**
 * Static Tailwind class map for the badge-color swatches. Tailwind JIT only
 * emits utilities it sees as literal strings in source — `bg-${c}-500/40`
 * would NOT reliably compile for every color. Keep this map in sync with
 * BADGE_COLOR_OPTIONS; the shape mirrors existing BADGE_COLOR_CLASSES in
 * src/app/admin/roles/page.tsx.
 */
export const SWATCH_CLASS: Record<string, string> = {
  red: "bg-red-500/40 border-red-500/60",
  amber: "bg-amber-500/40 border-amber-500/60",
  orange: "bg-orange-500/40 border-orange-500/60",
  yellow: "bg-yellow-500/40 border-yellow-500/60",
  emerald: "bg-emerald-500/40 border-emerald-500/60",
  teal: "bg-teal-500/40 border-teal-500/60",
  cyan: "bg-cyan-500/40 border-cyan-500/60",
  indigo: "bg-indigo-500/40 border-indigo-500/60",
  purple: "bg-purple-500/40 border-purple-500/60",
  zinc: "bg-zinc-500/40 border-zinc-500/60",
  slate: "bg-slate-500/40 border-slate-500/60",
};

export function FieldViolations({ messages }: { messages?: string[] }) {
  if (!messages || messages.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-red-400">
      {messages.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}

export function OverrideToggle({
  on,
  onChange,
  labelOn,
  labelOff,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  labelOn?: string;
  labelOff?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        on
          ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
          : "bg-zinc-500/10 text-muted border border-zinc-500/30"
      }`}
    >
      {on ? (labelOn ?? "Override") : (labelOff ?? "Inherit")}
    </button>
  );
}

export function BasicsCard({ form, setForm, codeDefaults, violationsByField }: SectionProps) {
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4" open>
      <summary className="cursor-pointer select-none text-sm font-semibold text-foreground">
        Basics
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        {/* Label */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Label</label>
            <OverrideToggle
              on={form.label.on}
              onChange={(on) => setForm((p) => ({ ...p, label: { ...p.label, on } }))}
            />
          </div>
          <input
            type="text"
            maxLength={LABEL_MAX_LEN}
            disabled={!form.label.on}
            value={form.label.value}
            onChange={(e) => setForm((p) => ({ ...p, label: { ...p.label, value: e.target.value } }))}
            placeholder={codeDefaults.label}
            className="mt-1 w-full rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-sm text-foreground disabled:opacity-60"
          />
          <FieldViolations messages={violationsByField.get("label")} />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Description</label>
            <OverrideToggle
              on={form.description.on}
              onChange={(on) => setForm((p) => ({ ...p, description: { ...p.description, on } }))}
            />
          </div>
          <textarea
            maxLength={DESCRIPTION_MAX_LEN}
            disabled={!form.description.on}
            value={form.description.value}
            onChange={(e) =>
              setForm((p) => ({ ...p, description: { ...p.description, value: e.target.value } }))
            }
            placeholder={codeDefaults.description}
            rows={2}
            className="mt-1 w-full rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-sm text-foreground disabled:opacity-60"
          />
          <FieldViolations messages={violationsByField.get("description")} />
        </div>

        {/* Scope */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Scope</label>
            <OverrideToggle
              on={form.scope.on}
              onChange={(on) => setForm((p) => ({ ...p, scope: { ...p.scope, on } }))}
            />
          </div>
          <div className="mt-1 flex gap-1 rounded-lg border border-t-border/60 bg-surface-2 p-1">
            {SCOPE_VALUES.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!form.scope.on}
                onClick={() => setForm((p) => ({ ...p, scope: { ...p.scope, value: s } }))}
                className={`flex-1 rounded px-2 py-1 text-xs font-medium capitalize ${
                  form.scope.value === s && form.scope.on
                    ? "bg-orange-500/30 text-orange-200"
                    : "text-muted hover:bg-surface"
                } disabled:opacity-60`}
              >
                {s}
              </button>
            ))}
          </div>
          <FieldViolations messages={violationsByField.get("scope")} />
        </div>

        {/* visibleInPicker */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted">Visible in role picker</label>
            <OverrideToggle
              on={form.visibleInPicker.on}
              onChange={(on) =>
                setForm((p) => ({ ...p, visibleInPicker: { ...p.visibleInPicker, on } }))
              }
            />
          </div>
          <div className="mt-1 flex gap-1 rounded-lg border border-t-border/60 bg-surface-2 p-1">
            {[
              { v: true, label: "On" },
              { v: false, label: "Off" },
            ].map((opt) => (
              <button
                key={String(opt.v)}
                type="button"
                disabled={!form.visibleInPicker.on}
                onClick={() =>
                  setForm((p) => ({
                    ...p,
                    visibleInPicker: { ...p.visibleInPicker, value: opt.v },
                  }))
                }
                className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                  form.visibleInPicker.value === opt.v && form.visibleInPicker.on
                    ? "bg-orange-500/30 text-orange-200"
                    : "text-muted hover:bg-surface"
                } disabled:opacity-60`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Badge */}
        <div>
          <label className="text-xs font-medium text-muted">Badge</label>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted">Color</span>
                <OverrideToggle
                  on={form.badgeColor.on}
                  onChange={(on) =>
                    setForm((p) => ({ ...p, badgeColor: { ...p.badgeColor, on } }))
                  }
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {BADGE_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={!form.badgeColor.on}
                    onClick={() =>
                      setForm((p) => ({ ...p, badgeColor: { ...p.badgeColor, value: c } }))
                    }
                    className={`h-6 w-6 rounded border disabled:opacity-50 ${
                      form.badgeColor.value === c && form.badgeColor.on
                        ? "ring-2 ring-orange-400"
                        : ""
                    } ${SWATCH_CLASS[c]}`}
                    title={c}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wide text-muted">Abbrev</span>
                <OverrideToggle
                  on={form.badgeAbbrev.on}
                  onChange={(on) =>
                    setForm((p) => ({ ...p, badgeAbbrev: { ...p.badgeAbbrev, on } }))
                  }
                />
              </div>
              <input
                type="text"
                maxLength={BADGE_ABBREV_MAX_LEN}
                disabled={!form.badgeAbbrev.on}
                value={form.badgeAbbrev.value}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    badgeAbbrev: { ...p.badgeAbbrev, value: e.target.value },
                  }))
                }
                placeholder={codeDefaults.badge.abbrev}
                className="mt-1 w-full rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-sm text-foreground disabled:opacity-60"
              />
            </div>
          </div>
          <FieldViolations messages={violationsByField.get("badge")} />
        </div>
      </div>
    </details>
  );
}

export function SuitesCard({ form, setForm, codeDefaults, violationsByField }: SectionProps) {
  const onChecked = (href: string, checked: boolean) => {
    setForm((p) => {
      const cur = new Set(p.suites.value);
      if (checked) cur.add(href);
      else cur.delete(href);
      return { ...p, suites: { ...p.suites, value: Array.from(cur) } };
    });
  };
  const copyDefaults = () =>
    setForm((p) => ({ ...p, suites: { on: true, value: [...codeDefaults.suites] } }));
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-foreground">
        <span>Suites ({form.suites.on ? form.suites.value.length : codeDefaults.suites.length})</span>
        <OverrideToggle
          on={form.suites.on}
          onChange={(on) => setForm((p) => ({ ...p, suites: { ...p.suites, on } }))}
        />
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <button
          type="button"
          onClick={copyDefaults}
          className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated"
        >
          Copy from code defaults
        </button>
        <ul className="space-y-1">
          {SUITE_OPTIONS.map((href) => {
            const checked = form.suites.on
              ? form.suites.value.includes(href)
              : codeDefaults.suites.includes(href);
            return (
              <li key={href} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!form.suites.on}
                  checked={checked}
                  onChange={(e) => onChecked(href, e.target.checked)}
                />
                <code className="text-xs text-muted">{href}</code>
              </li>
            );
          })}
        </ul>
        <FieldViolations messages={violationsByField.get("suites")} />
      </div>
    </details>
  );
}

export function RoutesCard({
  form,
  setForm,
  codeDefaults,
  allKnownRoutes,
  violationsByField,
}: SectionProps) {
  const copyDefaults = () =>
    setForm((p) => ({
      ...p,
      allowedRoutes: { on: true, value: [...codeDefaults.allowedRoutes] },
    }));
  const setAt = (idx: number, value: string) =>
    setForm((p) => ({
      ...p,
      allowedRoutes: {
        ...p.allowedRoutes,
        value: p.allowedRoutes.value.map((r, i) => (i === idx ? value : r)),
      },
    }));
  const removeAt = (idx: number) =>
    setForm((p) => ({
      ...p,
      allowedRoutes: {
        ...p.allowedRoutes,
        value: p.allowedRoutes.value.filter((_, i) => i !== idx),
      },
    }));
  const add = () =>
    setForm((p) => ({
      ...p,
      allowedRoutes: { ...p.allowedRoutes, value: [...p.allowedRoutes.value, ""] },
    }));
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-foreground">
        <span>
          Allowed routes (
          {form.allowedRoutes.on
            ? form.allowedRoutes.value.length
            : codeDefaults.allowedRoutes.length}
          )
        </span>
        <OverrideToggle
          on={form.allowedRoutes.on}
          onChange={(on) =>
            setForm((p) => ({ ...p, allowedRoutes: { ...p.allowedRoutes, on } }))
          }
        />
      </summary>
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyDefaults}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated"
          >
            Copy from code defaults
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!form.allowedRoutes.on}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated disabled:opacity-50"
          >
            + Add route
          </button>
        </div>
        <datalist id="role-editor-all-routes">
          {(allKnownRoutes ?? []).map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <ul className="space-y-1">
          {(form.allowedRoutes.on ? form.allowedRoutes.value : codeDefaults.allowedRoutes).map(
            (route, idx) => {
              const valid = route === "*" || route.startsWith("/");
              return (
                <li key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    list="role-editor-all-routes"
                    disabled={!form.allowedRoutes.on}
                    value={route}
                    onChange={(e) => setAt(idx, e.target.value)}
                    className={`flex-1 rounded border px-2 py-1 font-mono text-xs ${
                      valid ? "border-t-border/60" : "border-red-500/60"
                    } bg-surface-2 text-foreground disabled:opacity-60`}
                  />
                  <button
                    type="button"
                    disabled={!form.allowedRoutes.on}
                    onClick={() => removeAt(idx)}
                    className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
                    aria-label="Remove route"
                  >
                    ×
                  </button>
                </li>
              );
            },
          )}
        </ul>
        <FieldViolations messages={violationsByField.get("allowedRoutes")} />
      </div>
    </details>
  );
}

export function LandingCardsCard({
  form,
  setForm,
  codeDefaults,
  violationsByField,
}: SectionProps) {
  const cards = form.landingCards.on ? form.landingCards.value : codeDefaults.landingCards;
  const copyDefaults = () =>
    setForm((p) => ({
      ...p,
      landingCards: { on: true, value: [...codeDefaults.landingCards] },
    }));
  const move = (idx: number, dir: -1 | 1) =>
    setForm((p) => {
      const arr = [...p.landingCards.value];
      const target = idx + dir;
      if (target < 0 || target >= arr.length) return p;
      [arr[idx], arr[target]] = [arr[target], arr[idx]];
      return { ...p, landingCards: { ...p.landingCards, value: arr } };
    });
  const updateAt = (idx: number, patch: Partial<LandingCard>) =>
    setForm((p) => ({
      ...p,
      landingCards: {
        ...p.landingCards,
        value: p.landingCards.value.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
      },
    }));
  const removeAt = (idx: number) =>
    setForm((p) => ({
      ...p,
      landingCards: {
        ...p.landingCards,
        value: p.landingCards.value.filter((_, i) => i !== idx),
      },
    }));
  const add = () =>
    setForm((p) => ({
      ...p,
      landingCards: {
        ...p.landingCards,
        value: [
          ...p.landingCards.value,
          { href: "", title: "", description: "", tag: "", tagColor: "blue" },
        ],
      },
    }));
  return (
    <details className="group rounded-lg border border-t-border/60 bg-surface p-4">
      <summary className="flex cursor-pointer select-none items-center justify-between text-sm font-semibold text-foreground">
        <span>Landing cards ({cards.length} / {LANDING_CARDS_MAX})</span>
        <OverrideToggle
          on={form.landingCards.on}
          onChange={(on) =>
            setForm((p) => ({ ...p, landingCards: { ...p.landingCards, on } }))
          }
        />
      </summary>
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyDefaults}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated"
          >
            Copy from code defaults
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!form.landingCards.on || cards.length >= LANDING_CARDS_MAX}
            className="rounded border border-t-border/60 bg-surface-2 px-2 py-1 text-xs text-foreground hover:bg-surface-elevated disabled:opacity-50"
          >
            + Add card
          </button>
        </div>
        <ul className="space-y-2">
          {cards.map((card, idx) => (
            <li
              key={idx}
              className="rounded border border-t-border/60 bg-surface-2 p-2 text-xs"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!form.landingCards.on || idx === 0}
                  onClick={() => move(idx, -1)}
                  className="rounded px-1 text-muted hover:text-foreground disabled:opacity-40"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={!form.landingCards.on || idx === cards.length - 1}
                  onClick={() => move(idx, 1)}
                  className="rounded px-1 text-muted hover:text-foreground disabled:opacity-40"
                  aria-label="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  disabled={!form.landingCards.on}
                  onClick={() => removeAt(idx)}
                  className="ml-auto rounded px-1 text-muted hover:text-red-400 disabled:opacity-40"
                  aria-label="Remove card"
                >
                  ×
                </button>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <input
                  type="text"
                  list="role-editor-all-routes"
                  disabled={!form.landingCards.on}
                  placeholder="href (/dashboards/…)"
                  value={card.href}
                  onChange={(e) => updateAt(idx, { href: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 font-mono text-[11px] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!form.landingCards.on}
                  placeholder="title"
                  value={card.title}
                  onChange={(e) => updateAt(idx, { title: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!form.landingCards.on}
                  placeholder="description"
                  value={card.description}
                  onChange={(e) => updateAt(idx, { description: e.target.value })}
                  className="col-span-2 rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                />
                <input
                  type="text"
                  disabled={!form.landingCards.on}
                  placeholder="tag (e.g. SCHEDULING)"
                  value={card.tag}
                  onChange={(e) => updateAt(idx, { tag: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                />
                <select
                  disabled={!form.landingCards.on}
                  value={card.tagColor}
                  onChange={(e) => updateAt(idx, { tagColor: e.target.value })}
                  className="rounded border border-t-border/60 bg-surface px-2 py-1 text-[11px] disabled:opacity-60"
                >
                  {BADGE_COLOR_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
        <FieldViolations messages={violationsByField.get("landingCards")} />
      </div>
    </details>
  );
}
