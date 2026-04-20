"use client";

import { useId, useState, type ReactNode } from "react";

// ── FormField: label + children + help + error ─────────────────
export interface FormFieldProps {
  label: string;
  help?: string;
  error?: string;
  children: ReactNode; // the input; use the `id` prop from getFieldIds if you need label association for custom inputs
  required?: boolean;
}
export function FormField({ label, help, error, children, required }: FormFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      {children}
      {error && <span className="text-xs text-red-400">{error}</span>}
      {help && <span className="text-xs text-muted">{help}</span>}
    </label>
  );
}

// ── FormInput ─────────────────────────────────────────────────
export interface FormInputProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  help?: string;
  error?: string;
  type?: "text" | "email" | "url" | "number";
  required?: boolean;
}
export function FormInput({ label, value, onChange, placeholder, help, error, type = "text", required }: FormInputProps) {
  const id = useId();
  const [internal, setInternal] = useState(value);
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">
        {label} {required && <span className="text-red-400">*</span>}
      </span>
      <input
        id={id}
        type={type}
        value={internal}
        placeholder={placeholder}
        onChange={(e) => {
          setInternal(e.target.value);
          onChange(e.target.value);
        }}
        className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-t-border focus:outline-none"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
      {help && <span className="text-xs text-muted">{help}</span>}
    </label>
  );
}

// ── FormSelect ────────────────────────────────────────────────
export interface FormSelectOption {
  value: string;
  label: string;
}
export interface FormSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FormSelectOption[];
  help?: string;
  error?: string;
}
export function FormSelect({ label, value, onChange, options, help, error }: FormSelectProps) {
  const id = useId();
  const [internal, setInternal] = useState(value);
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <select
        id={id}
        value={internal}
        onChange={(e) => { setInternal(e.target.value); onChange(e.target.value); }}
        className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground focus:border-t-border focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : help ? (
        <span className="text-xs text-muted">{help}</span>
      ) : null}
    </label>
  );
}

// ── FormTextarea ─────────────────────────────────────────────
export interface FormTextareaProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  help?: string;
  error?: string;
}
export function FormTextarea({ label, value, onChange, placeholder, rows = 3, help, error }: FormTextareaProps) {
  const id = useId();
  const [internal, setInternal] = useState(value);
  return (
    <label htmlFor={id} className="flex flex-col gap-1">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <textarea
        id={id}
        value={internal}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => { setInternal(e.target.value); onChange(e.target.value); }}
        className="rounded-md border border-t-border/60 bg-surface-2 px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-t-border focus:outline-none"
      />
      {error ? (
        <span className="text-xs text-red-400">{error}</span>
      ) : help ? (
        <span className="text-xs text-muted">{help}</span>
      ) : null}
    </label>
  );
}

// ── FormToggle (aria-switch) ─────────────────────────────────
export interface FormToggleProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  help?: string;
}
export function FormToggle({ label, checked, onChange, help }: FormToggleProps) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-t-border/60 bg-surface-2 px-3 py-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {help && <span className="text-xs text-muted">{help}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-green-500/70" : "bg-surface-elevated"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-foreground transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  );
}
