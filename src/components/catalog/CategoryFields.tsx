"use client";

import { getCategoryFields, type FieldDef } from "@/lib/catalog-fields";
import FieldTooltip from "./FieldTooltip";
import type { ValidationError } from "@/lib/catalog-form-state";

interface CategoryFieldsProps {
  category: string;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  showTooltips?: boolean;
  prefillFields?: Set<string>;
  onClearPrefill?: (key: string) => void;
  errors?: ValidationError[];
  touchedFields?: Set<string>;
  onFieldBlur?: (field: string) => void;
}

const inputClasses =
  "w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-cyan-500/50";

function NumberField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        step="any"
        value={value != null ? String(value) : ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? "" : Number(e.target.value))
        }
        placeholder={field.placeholder}
        className={`${inputClasses} ${field.unit ? "pr-12" : ""}`}
      />
      {field.unit && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          {field.unit}
        </span>
      )}
    </div>
  );
}

function TextField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.placeholder}
      className={inputClasses}
    />
  );
}

function DropdownField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <select
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      className={inputClasses}
    >
      <option value="">Select...</option>
      {field.options?.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

function ToggleField({
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const checked = Boolean(value);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 ${
        checked ? "bg-cyan-500" : "bg-zinc-600"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const FIELD_RENDERERS: Record<
  FieldDef["type"],
  React.ComponentType<{
    field: FieldDef;
    value: unknown;
    onChange: (v: unknown) => void;
  }>
> = {
  number: NumberField,
  text: TextField,
  dropdown: DropdownField,
  toggle: ToggleField,
};

export default function CategoryFields({
  category,
  values,
  onChange,
  showTooltips,
  prefillFields,
  onClearPrefill,
  errors,
  touchedFields,
  onFieldBlur,
}: CategoryFieldsProps) {
  const fields = getCategoryFields(category);

  const fieldError = (key: string): string | undefined => {
    const field = `spec.${key}`;
    if (!touchedFields?.has(field)) return undefined;
    return errors?.find((e) => e.field === field)?.message;
  };

  if (fields.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3">
        Category Specifications
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fields.map((field) => {
          const Renderer = FIELD_RENDERERS[field.type];
          const error = fieldError(field.key);
          return (
            <div
              key={field.key}
              className={
                prefillFields?.has(`spec.${field.key}`)
                  ? "border-l-2 border-l-blue-400 pl-3"
                  : ""
              }
              onBlur={() => onFieldBlur?.(`spec.${field.key}`)}
            >
              <label className="text-sm font-medium text-muted mb-1 block">
                {field.label}
                {field.required && (
                  <span className="text-red-400 ml-0.5">*</span>
                )}
                {showTooltips && field.tooltip && (
                  <FieldTooltip text={field.tooltip} />
                )}
              </label>
              <div className={error ? "ring-2 ring-red-500/50 rounded-lg" : ""}>
                <Renderer
                  field={field}
                  value={values[field.key]}
                  onChange={(v) => {
                    onChange(field.key, v);
                    onClearPrefill?.(field.key);
                  }}
                />
              </div>
              {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
