# Catalog Form Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the single-page catalog new product form with a 4-step wizard (Start Mode → Basics → Details → Review) plus Clone and AI Datasheet Import features.

**Architecture:** Break the monolithic 660-line page.tsx into a thin wizard shell + 6 step components. Shared form state lives in the parent via a single `useReducer`. The AI extraction endpoint uses Claude API with tool_use for structured output. Existing CategoryFields, BrandDropdown, and catalog-fields.ts are reused as-is.

**Tech Stack:** Next.js 16, React 19, Tailwind v4, Claude API (Anthropic SDK), pdf-parse for PDF-to-text.

**Design Doc:** `docs/plans/2026-03-13-catalog-form-wizard-design.md`

---

## Task 1: Form State Reducer & Types

**Files:**
- Create: `src/lib/catalog-form-state.ts`
- Test: `src/__tests__/lib/catalog-form-state.test.ts`

This extracts the 22 state variables from `new/page.tsx:41-67` into a typed reducer so all wizard steps share state.

**Step 1: Write the failing test**

```typescript
// src/__tests__/lib/catalog-form-state.test.ts
import { catalogFormReducer, initialFormState, type CatalogFormState } from "@/lib/catalog-form-state";

describe("catalogFormReducer", () => {
  it("returns initial state", () => {
    expect(initialFormState.category).toBe("");
    expect(initialFormState.brand).toBe("");
    expect(initialFormState.systems).toEqual(new Set(["INTERNAL"]));
    expect(initialFormState.specValues).toEqual({});
  });

  it("handles SET_FIELD for string fields", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "SET_FIELD",
      field: "brand",
      value: "Hanwha",
    });
    expect(state.brand).toBe("Hanwha");
  });

  it("handles SET_CATEGORY and resets specValues", () => {
    const withSpecs = { ...initialFormState, specValues: { wattage: 400 } };
    const state = catalogFormReducer(withSpecs, {
      type: "SET_CATEGORY",
      category: "INVERTER",
    });
    expect(state.category).toBe("INVERTER");
    expect(state.specValues).toEqual({});
  });

  it("handles TOGGLE_SYSTEM", () => {
    const state = catalogFormReducer(initialFormState, {
      type: "TOGGLE_SYSTEM",
      system: "HUBSPOT",
    });
    expect(state.systems.has("HUBSPOT")).toBe(true);
    // Toggle off
    const state2 = catalogFormReducer(state, {
      type: "TOGGLE_SYSTEM",
      system: "HUBSPOT",
    });
    expect(state2.systems.has("HUBSPOT")).toBe(false);
    // INTERNAL cannot be toggled off
    const state3 = catalogFormReducer(initialFormState, {
      type: "TOGGLE_SYSTEM",
      system: "INTERNAL",
    });
    expect(state3.systems.has("INTERNAL")).toBe(true);
  });

  it("handles PREFILL_FROM_PRODUCT for clone", () => {
    const product = {
      category: "MODULE",
      brand: "Hanwha",
      model: "Q.PEAK 400",
      description: "400W Module",
      unitSpec: "400",
      unitLabel: "W",
      unitCost: "150",
      sellPrice: "200",
      hardToProcure: false,
      specValues: { wattage: 400 },
    };
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      product,
      source: "clone",
    });
    expect(state.brand).toBe("Hanwha");
    expect(state.model).toBe("Q.PEAK 400");
    expect(state.sku).toBe(""); // cleared on clone
    expect(state.vendorPartNumber).toBe(""); // cleared on clone
    expect(state.prefillSource).toBe("clone");
    expect(state.prefillFields).toContain("brand");
  });

  it("handles PREFILL_FROM_PRODUCT for datasheet", () => {
    const extracted = {
      category: "BATTERY",
      brand: "Tesla",
      model: "Powerwall 3",
      description: "Home battery",
      specValues: { capacity: 13.5 },
    };
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT",
      product: extracted,
      source: "datasheet",
    });
    expect(state.prefillSource).toBe("datasheet");
    expect(state.prefillFields).toContain("brand");
    expect(state.prefillFields).not.toContain("sku"); // wasn't provided
  });

  it("handles CLEAR_PREFILL_FIELD", () => {
    const prefilled = {
      ...initialFormState,
      brand: "Hanwha",
      prefillSource: "clone" as const,
      prefillFields: new Set(["brand", "model"]),
    };
    const state = catalogFormReducer(prefilled, {
      type: "CLEAR_PREFILL_FIELD",
      field: "brand",
    });
    expect(state.prefillFields.has("brand")).toBe(false);
    expect(state.prefillFields.has("model")).toBe(true);
  });

  it("handles RESET", () => {
    const dirty = { ...initialFormState, brand: "Hanwha", model: "Q.PEAK" };
    const state = catalogFormReducer(dirty, { type: "RESET" });
    expect(state).toEqual(initialFormState);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=catalog-form-state`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// src/lib/catalog-form-state.ts

export interface CatalogFormState {
  // Step 1: Basics
  category: string;
  brand: string;
  model: string;
  description: string;
  // Step 2: Details
  sku: string;
  vendorName: string;
  vendorPartNumber: string;
  unitSpec: string;
  unitLabel: string;
  unitCost: string;
  sellPrice: string;
  hardToProcure: boolean;
  length: string;
  width: string;
  weight: string;
  specValues: Record<string, unknown>;
  // Step 3: Systems
  systems: Set<string>;
  // Prefill tracking
  prefillSource: "clone" | "datasheet" | null;
  prefillFields: Set<string>;
}

export const initialFormState: CatalogFormState = {
  category: "",
  brand: "",
  model: "",
  description: "",
  sku: "",
  vendorName: "",
  vendorPartNumber: "",
  unitSpec: "",
  unitLabel: "",
  unitCost: "",
  sellPrice: "",
  hardToProcure: false,
  length: "",
  width: "",
  weight: "",
  specValues: {},
  systems: new Set(["INTERNAL"]),
  prefillSource: null,
  prefillFields: new Set(),
};

// Fields that are cleared when cloning (must be unique per product)
const CLONE_CLEAR_FIELDS = ["sku", "vendorPartNumber"] as const;

export type CatalogFormAction =
  | { type: "SET_FIELD"; field: keyof CatalogFormState; value: unknown }
  | { type: "SET_CATEGORY"; category: string }
  | { type: "SET_SPEC"; key: string; value: unknown }
  | { type: "TOGGLE_SYSTEM"; system: string }
  | { type: "PREFILL_FROM_PRODUCT"; product: Partial<CatalogFormState>; source: "clone" | "datasheet" }
  | { type: "CLEAR_PREFILL_FIELD"; field: string }
  | { type: "RESET" };

export function catalogFormReducer(
  state: CatalogFormState,
  action: CatalogFormAction
): CatalogFormState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };

    case "SET_CATEGORY":
      return { ...state, category: action.category, specValues: {} };

    case "SET_SPEC":
      return {
        ...state,
        specValues: { ...state.specValues, [action.key]: action.value },
      };

    case "TOGGLE_SYSTEM": {
      if (action.system === "INTERNAL") return state; // can't toggle off
      const next = new Set(state.systems);
      if (next.has(action.system)) next.delete(action.system);
      else next.add(action.system);
      return { ...state, systems: next };
    }

    case "PREFILL_FROM_PRODUCT": {
      const filledFields = new Set<string>();
      const updates: Partial<CatalogFormState> = {};
      for (const [key, value] of Object.entries(action.product)) {
        if (value !== undefined && value !== null && value !== "") {
          (updates as Record<string, unknown>)[key] = value;
          filledFields.add(key);
        }
      }
      if (action.source === "clone") {
        for (const f of CLONE_CLEAR_FIELDS) {
          (updates as Record<string, unknown>)[f] = "";
          filledFields.delete(f);
        }
      }
      return {
        ...state,
        ...updates,
        prefillSource: action.source,
        prefillFields: filledFields,
      };
    }

    case "CLEAR_PREFILL_FIELD": {
      const next = new Set(state.prefillFields);
      next.delete(action.field);
      return { ...state, prefillFields: next };
    }

    case "RESET":
      return initialFormState;

    default:
      return state;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern=catalog-form-state`
Expected: all 7 tests PASS

**Step 5: Commit**

```
git add src/lib/catalog-form-state.ts src/__tests__/lib/catalog-form-state.test.ts
git commit -m "feat(catalog): add form state reducer for wizard"
```

---

## Task 2: Wizard Progress Bar Component

**Files:**
- Create: `src/components/catalog/WizardProgress.tsx`

No test file — this is a pure presentational component.

**Step 1: Write the component**

```tsx
// src/components/catalog/WizardProgress.tsx
"use client";

const STEPS = [
  { key: "start", label: "Start" },
  { key: "basics", label: "Basics" },
  { key: "details", label: "Details" },
  { key: "review", label: "Review" },
] as const;

export type WizardStep = (typeof STEPS)[number]["key"];

interface WizardProgressProps {
  currentStep: WizardStep;
}

export default function WizardProgress({ currentStep }: WizardProgressProps) {
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

  return (
    <div className="mb-8">
      {/* Desktop: full labels */}
      <div className="hidden sm:flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    isComplete
                      ? "bg-cyan-500 text-white"
                      : isCurrent
                        ? "bg-cyan-500/20 text-cyan-400 ring-2 ring-cyan-500"
                        : "bg-surface-2 text-muted"
                  }`}
                >
                  {isComplete ? "✓" : i + 1}
                </div>
                <span
                  className={`text-sm font-medium ${
                    isCurrent ? "text-foreground" : "text-muted"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-4 rounded ${
                    isComplete ? "bg-cyan-500" : "bg-surface-2"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Mobile: compact dots */}
      <div className="flex sm:hidden items-center justify-center gap-2">
        {STEPS.map((step, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex;
          return (
            <div
              key={step.key}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                isComplete
                  ? "bg-cyan-500"
                  : isCurrent
                    ? "bg-cyan-400 ring-2 ring-cyan-500/50"
                    : "bg-surface-2"
              }`}
            />
          );
        })}
        <span className="ml-2 text-sm text-muted">
          {STEPS[currentIndex]?.label}
        </span>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
git add src/components/catalog/WizardProgress.tsx
git commit -m "feat(catalog): add wizard progress bar component"
```

---

## Task 3: Start Mode Step (Clone + Datasheet Import)

**Files:**
- Create: `src/components/catalog/StartModeStep.tsx`
- Create: `src/components/catalog/CloneSearch.tsx`
- Create: `src/components/catalog/DatasheetImport.tsx`

**Step 1: Write CloneSearch**

```tsx
// src/components/catalog/CloneSearch.tsx
"use client";
import { useState } from "react";

interface CloneResult {
  id: string;
  category: string;
  brand: string;
  model: string;
  description: string | null;
  unitSpec: string | null;
  unitLabel: string | null;
  unitCost: number | null;
  sellPrice: number | null;
  hardToProcure: boolean;
  metadata: Record<string, unknown> | null;
}

interface CloneSearchProps {
  onSelect: (product: CloneResult) => void;
  onCancel: () => void;
}

export default function CloneSearch({ onSelect, onCancel }: CloneSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CloneResult[]>([]);
  const [loading, setLoading] = useState(false);

  async function search(q: string) {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="Search by brand, model, or description..."
          className="flex-1 rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
          autoFocus
        />
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      {loading && <p className="text-sm text-muted">Searching...</p>}
      {results.length > 0 && (
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(r)}
              className="w-full text-left rounded-lg border border-t-border bg-surface-2 p-3 hover:bg-surface transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
                  {r.category}
                </span>
                <span className="text-sm font-medium text-foreground">
                  {r.brand} — {r.model}
                </span>
              </div>
              {r.description && (
                <p className="text-xs text-muted mt-1 line-clamp-1">{r.description}</p>
              )}
            </button>
          ))}
        </div>
      )}
      {query.length >= 2 && !loading && results.length === 0 && (
        <p className="text-sm text-muted">No matching products found.</p>
      )}
    </div>
  );
}
```

**Step 2: Write DatasheetImport**

```tsx
// src/components/catalog/DatasheetImport.tsx
"use client";
import { useState, useCallback } from "react";

interface ExtractedProduct {
  category?: string;
  brand?: string;
  model?: string;
  description?: string;
  unitSpec?: string;
  unitLabel?: string;
  specValues?: Record<string, unknown>;
  fieldCount?: number;
  totalFields?: number;
}

interface DatasheetImportProps {
  onExtracted: (product: ExtractedProduct) => void;
  onCancel: () => void;
}

export default function DatasheetImport({ onExtracted, onCancel }: DatasheetImportProps) {
  const [mode, setMode] = useState<"choose" | "paste">("choose");
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const extract = useCallback(async (body: FormData | { text: string }) => {
    setLoading(true);
    setError(null);
    try {
      const isFormData = body instanceof FormData;
      const res = await fetch("/api/catalog/extract-from-datasheet", {
        method: "POST",
        ...(isFormData ? { body } : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Extraction failed" }));
        throw new Error(err.error || "Extraction failed");
      }
      const data: ExtractedProduct = await res.json();
      onExtracted(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed. Try pasting specs as text instead.");
    } finally {
      setLoading(false);
    }
  }, [onExtracted]);

  function handleFile(file: File) {
    if (!file.name.endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10MB.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    extract(fd);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted">Extracting product details...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Import from Datasheet</h3>
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-foreground">
          Cancel
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {mode === "choose" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* PDF Upload */}
          <label
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors ${
              dragOver
                ? "border-cyan-500 bg-cyan-500/10"
                : "border-t-border hover:border-cyan-500/50 hover:bg-surface-2"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFile(file);
            }}
          >
            <svg className="w-8 h-8 text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <span className="text-sm font-medium text-foreground">Upload PDF</span>
            <span className="text-xs text-muted mt-1">Drag & drop or click to browse</span>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </label>

          {/* Paste Text */}
          <button
            type="button"
            onClick={() => setMode("paste")}
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-t-border p-8 hover:border-cyan-500/50 hover:bg-surface-2 transition-colors"
          >
            <svg className="w-8 h-8 text-muted mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="text-sm font-medium text-foreground">Paste Specs</span>
            <span className="text-xs text-muted mt-1">From a website or datasheet</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste product specifications here..."
            rows={8}
            className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMode("choose")}
              className="px-4 py-2 text-sm text-muted hover:text-foreground"
            >
              Back
            </button>
            <button
              type="button"
              disabled={pasteText.trim().length < 10}
              onClick={() => extract({ text: pasteText.trim() })}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Extract Fields
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 3: Write StartModeStep**

```tsx
// src/components/catalog/StartModeStep.tsx
"use client";
import { useState } from "react";
import CloneSearch from "./CloneSearch";
import DatasheetImport from "./DatasheetImport";

type StartMode = "choose" | "clone" | "datasheet";

interface StartModeStepProps {
  onStartScratch: () => void;
  onClone: (product: Record<string, unknown>) => void;
  onDatasheetExtracted: (product: Record<string, unknown>) => void;
}

export default function StartModeStep({
  onStartScratch,
  onClone,
  onDatasheetExtracted,
}: StartModeStepProps) {
  const [mode, setMode] = useState<StartMode>("choose");

  if (mode === "clone") {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <CloneSearch onSelect={onClone} onCancel={() => setMode("choose")} />
      </div>
    );
  }

  if (mode === "datasheet") {
    return (
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <DatasheetImport onExtracted={onDatasheetExtracted} onCancel={() => setMode("choose")} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <button
        type="button"
        onClick={onStartScratch}
        className="flex flex-col items-center gap-3 rounded-xl border border-t-border bg-surface p-8 shadow-card hover:border-cyan-500/50 hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-full bg-cyan-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground">Start from Scratch</span>
        <span className="text-xs text-muted text-center">Blank form — fill in everything manually</span>
      </button>

      <button
        type="button"
        onClick={() => setMode("clone")}
        className="flex flex-col items-center gap-3 rounded-xl border border-t-border bg-surface p-8 shadow-card hover:border-green-500/50 hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground">Clone Existing Product</span>
        <span className="text-xs text-muted text-center">Copy from an existing catalog item</span>
      </button>

      <button
        type="button"
        onClick={() => setMode("datasheet")}
        className="flex flex-col items-center gap-3 rounded-xl border border-t-border bg-surface p-8 shadow-card hover:border-purple-500/50 hover:bg-surface-2 transition-colors"
      >
        <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center">
          <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
          </svg>
        </div>
        <span className="text-sm font-semibold text-foreground">Import from Datasheet</span>
        <span className="text-xs text-muted text-center">Upload PDF or paste specs — AI fills the form</span>
      </button>
    </div>
  );
}
```

**Step 4: Commit**

```
git add src/components/catalog/StartModeStep.tsx src/components/catalog/CloneSearch.tsx src/components/catalog/DatasheetImport.tsx
git commit -m "feat(catalog): add start mode step with clone search and datasheet import UI"
```

---

## Task 4: Catalog Search API Endpoint (for Clone)

**Files:**
- Create: `src/app/api/catalog/search/route.ts`

**Step 1: Write the endpoint**

```typescript
// src/app/api/catalog/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;
  if (!prisma) return NextResponse.json([], { status: 503 });

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 2) return NextResponse.json([]);

  const results = await prisma.equipmentSku.findMany({
    where: {
      isActive: true,
      OR: [
        { brand: { contains: q, mode: "insensitive" } },
        { model: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { vendorPartNumber: { contains: q, mode: "insensitive" } },
        { sku: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      category: true,
      brand: true,
      model: true,
      description: true,
      unitSpec: true,
      unitLabel: true,
      unitCost: true,
      sellPrice: true,
      sku: true,
      vendorName: true,
      vendorPartNumber: true,
      hardToProcure: true,
      length: true,
      width: true,
      weight: true,
      hubspotProductId: true,
      zuperItemId: true,
      zohoItemId: true,
      photoUrl: true,
      // Include category-specific spec relations for clone prefill
      moduleSpec: true,
      inverterSpec: true,
      batterySpec: true,
      evChargerSpec: true,
      mountingHardwareSpec: true,
      electricalHardwareSpec: true,
      relayDeviceSpec: true,
    },
    take: 20,
    orderBy: { brand: "asc" },
  });

  return NextResponse.json(results);
}
```

**Step 2: Commit**

```
git add src/app/api/catalog/search/route.ts
git commit -m "feat(catalog): add catalog search API for clone feature"
```

---

## Task 5: AI Datasheet Extraction Endpoint

**Files:**
- Create: `src/app/api/catalog/extract-from-datasheet/route.ts`

**Step 1: Install pdf-parse**

Run: `npm install pdf-parse`

**Step 2: Write the endpoint**

```typescript
// src/app/api/catalog/extract-from-datasheet/route.ts
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { FORM_CATEGORIES } from "@/lib/catalog-fields";

// Dynamic import for pdf-parse (CommonJS module)
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return data.text;
}

const EXTRACTION_TOOL = {
  name: "extract_product_info",
  description: "Extract structured solar equipment product information from text",
  input_schema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: FORM_CATEGORIES,
        description: "Product category",
      },
      brand: { type: "string", description: "Manufacturer/brand name" },
      model: { type: "string", description: "Model number or part number" },
      description: { type: "string", description: "Short product description" },
      unitSpec: { type: "string", description: "Primary numeric spec value (e.g. '400' for 400W module)" },
      unitLabel: { type: "string", description: "Unit for the spec (e.g. 'W', 'kWh', 'kW', 'A')" },
      specValues: {
        type: "object",
        description: "Category-specific specs. Keys: wattage, efficiency, cellType, capacity, acOutputSize, etc.",
      },
    },
    required: ["brand", "model"],
  },
};

export async function POST(request: NextRequest) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({ error: "AI extraction not configured" }, { status: 503 });
  }

  let text: string;
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "File must be under 10MB" }, { status: 400 });
    }
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      text = await extractPdfText(buffer);
    } catch {
      return NextResponse.json(
        { error: "Could not read PDF. Try pasting specs as text instead." },
        { status: 422 }
      );
    }
  } else {
    const body = await request.json();
    text = body.text;
    if (!text || typeof text !== "string" || text.trim().length < 10) {
      return NextResponse.json({ error: "Text too short to extract from" }, { status: 400 });
    }
  }

  // Truncate to ~8000 chars to stay within reasonable token limits
  const truncated = text.slice(0, 8000);

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: "extract_product_info" },
      messages: [
        {
          role: "user",
          content: `Extract solar equipment product information from this text. Only include fields you are confident about — leave out anything uncertain.\n\n${truncated}`,
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      return NextResponse.json({ error: "Could not extract product information" }, { status: 422 });
    }

    const extracted = toolBlock.input as Record<string, unknown>;

    // Count fields for confidence banner
    const fieldCount = Object.values(extracted).filter(
      (v) => v !== undefined && v !== null && v !== ""
    ).length;

    return NextResponse.json({ ...extracted, fieldCount, totalFields: 18 });
  } catch (err) {
    console.error("[catalog] Datasheet extraction failed:", err);
    return NextResponse.json(
      { error: "AI extraction failed. Try pasting specs as text instead." },
      { status: 500 }
    );
  }
}
```

**Step 3: Commit**

```
git add src/app/api/catalog/extract-from-datasheet/route.ts
git commit -m "feat(catalog): add AI datasheet extraction endpoint using Claude API"
```

---

## Task 6: Field Tooltip Component + Tooltip Data

**Files:**
- Create: `src/components/catalog/FieldTooltip.tsx`
- Modify: `src/lib/catalog-fields.ts` — add `tooltip` to FieldDef interface and data

**Step 1: Write FieldTooltip component**

```tsx
// src/components/catalog/FieldTooltip.tsx
"use client";
import { useState } from "react";

interface FieldTooltipProps {
  text: string;
}

export default function FieldTooltip({ text }: FieldTooltipProps) {
  const [show, setShow] = useState(false);

  return (
    <span className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="w-4 h-4 rounded-full bg-surface-2 text-muted text-[10px] font-bold inline-flex items-center justify-center hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors"
        aria-label="Field help"
      >
        ?
      </button>
      {show && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-lg bg-surface-elevated border border-t-border p-2.5 text-xs text-foreground shadow-lg">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-surface-elevated" />
        </div>
      )}
    </span>
  );
}
```

**Step 2: Add `tooltip` to FieldDef and populate data**

In `src/lib/catalog-fields.ts`, add `tooltip?: string` to the FieldDef interface (line ~11), then add tooltip strings to the field definitions. Example additions:

```typescript
// In FieldDef interface, add:
tooltip?: string;

// In MODULE fields, add tooltips:
{ key: "wattage", label: "DC Size (Wattage)", type: "number", unit: "W", tooltip: "Rated DC output in watts (e.g., 400 for a 400W panel)", ... },
{ key: "efficiency", label: "Efficiency", type: "number", unit: "%", tooltip: "Panel efficiency percentage from datasheet (e.g., 20.5)", ... },
```

Add tooltip data for all populated categories: MODULE (8 fields), INVERTER (7), BATTERY (8), EV_CHARGER (6), RACKING (6), ELECTRICAL_BOS (4), MONITORING (3).

**Step 3: Add `CATEGORY_DEFAULTS` map for smart defaults**

At the bottom of `catalog-fields.ts`, add:

```typescript
/** Smart defaults applied when a category is selected */
export const CATEGORY_DEFAULTS: Record<string, { unitLabel?: string; systems?: string[] }> = {
  MODULE:       { unitLabel: "W",   systems: ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"] },
  BATTERY:      { unitLabel: "kWh", systems: ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"] },
  BATTERY_EXPANSION: { unitLabel: "kWh", systems: ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"] },
  INVERTER:     { unitLabel: "kW",  systems: ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"] },
  EV_CHARGER:   { unitLabel: "A",   systems: ["INTERNAL", "HUBSPOT", "ZUPER", "ZOHO"] },
  SERVICE:      { systems: ["INTERNAL", "ZOHO"] },
  ADDER_SERVICES: { systems: ["INTERNAL", "ZOHO"] },
  PROJECT_MILESTONES: { systems: ["INTERNAL", "ZOHO"] },
};
```

**Step 4: Commit**

```
git add src/components/catalog/FieldTooltip.tsx src/lib/catalog-fields.ts
git commit -m "feat(catalog): add field tooltips and smart category defaults"
```

---

## Task 7: Basics Step Component

**Files:**
- Create: `src/components/catalog/BasicsStep.tsx`

Uses existing `BrandDropdown` and `CategoryFields` pattern. Shows category grid, brand, model, description. **Full duplicate-resolution workflow** matching the current form: searches by SKU, vendor part, brand+model; shows match cards with "Open Existing" links and a merge tool for resolving duplicates before proceeding.

**Step 1: Write BasicsStep**

```tsx
// src/components/catalog/BasicsStep.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import BrandDropdown from "./BrandDropdown";
import { FORM_CATEGORIES, getCategoryLabel } from "@/lib/catalog-fields";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface BasicsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onNext: () => void;
}

interface ExistingSkuMatch {
  id: string;
  category: string;
  brand: string;
  model: string;
  sku?: string;
  vendorPartNumber?: string;
  hubspotProductId?: string;
  zuperItemId?: string;
  zohoItemId?: string;
}

export default function BasicsStep({ state, dispatch, onNext }: BasicsStepProps) {
  const [existingMatches, setExistingMatches] = useState<ExistingSkuMatch[]>([]);
  const [existingMatchesLoading, setExistingMatchesLoading] = useState(false);
  const [mergeSourceSkuId, setMergeSourceSkuId] = useState("");
  const [mergeTargetSkuId, setMergeTargetSkuId] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<string | null>(null);

  // Multi-field duplicate lookup (same logic as current form: SKU, vendor part, brand+model, model)
  const existingLookupQuery = useMemo(() => {
    return [state.sku, state.vendorPartNumber, `${state.brand} ${state.model}`, state.model]
      .map((value) => String(value || "").trim())
      .find((value) => value.length >= 2) || "";
  }, [state.brand, state.model, state.sku, state.vendorPartNumber]);

  useEffect(() => {
    const query = existingLookupQuery.trim();
    if (!query) { setExistingMatches([]); return; }
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setExistingMatchesLoading(true);
      try {
        const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(query)}`);
        if (res.ok && !cancelled) {
          setExistingMatches(await res.json());
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setExistingMatchesLoading(false); }
    }, 500);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [existingLookupQuery]);

  // Merge handler (preserve existing merge workflow)
  async function handleMerge() {
    if (!mergeSourceSkuId || !mergeTargetSkuId || mergeSourceSkuId === mergeTargetSkuId) return;
    setMergeBusy(true);
    try {
      const res = await fetch("/api/inventory/skus/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSkuId: mergeSourceSkuId, targetSkuId: mergeTargetSkuId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMergeMessage("Merge complete.");
      setExistingMatches((prev) => prev.filter((m) => m.id !== mergeSourceSkuId));
    } catch (e) {
      setMergeMessage(e instanceof Error ? e.message : "Merge failed");
    } finally { setMergeBusy(false); }
  }

  const canProceed = state.category && state.brand && state.model && state.description;

  const isPrefilled = (field: string) => state.prefillFields.has(field);

  return (
    <div className="space-y-6">
      {/* Category Selection */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category <span className="text-red-400">*</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {FORM_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => dispatch({ type: "SET_CATEGORY", category: cat })}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                state.category === cat
                  ? "bg-cyan-500/20 text-cyan-400 ring-2 ring-cyan-500"
                  : "bg-surface-2 text-muted hover:text-foreground hover:bg-surface-2/80"
              } ${isPrefilled("category") ? "border-l-2 border-l-green-400" : ""}`}
            >
              {getCategoryLabel(cat) || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Product Identity */}
      {state.category && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Product Identity</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={isPrefilled("brand") ? "border-l-2 border-l-green-400 pl-3" : ""}>
              <label className="block text-sm font-medium text-muted mb-1">
                Brand <span className="text-red-400">*</span>
              </label>
              <BrandDropdown
                value={state.brand}
                onChange={(v) => {
                  dispatch({ type: "SET_FIELD", field: "brand", value: v });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "brand" });
                }}
              />
            </div>
            <div className={isPrefilled("model") ? "border-l-2 border-l-green-400 pl-3" : ""}>
              <label className="block text-sm font-medium text-muted mb-1">
                Model / Part # <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={state.model}
                onChange={(e) => {
                  dispatch({ type: "SET_FIELD", field: "model", value: e.target.value });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "model" });
                }}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div className={`sm:col-span-2 ${isPrefilled("description") ? "border-l-2 border-l-green-400 pl-3" : ""}`}>
              <label className="block text-sm font-medium text-muted mb-1">
                Description <span className="text-red-400">*</span>
              </label>
              <textarea
                value={state.description}
                onChange={(e) => {
                  dispatch({ type: "SET_FIELD", field: "description", value: e.target.value });
                  dispatch({ type: "CLEAR_PREFILL_FIELD", field: "description" });
                }}
                rows={3}
                className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Existing Product Matches — full duplicate resolution workflow */}
      {existingMatches.length > 0 && (
        <div className="bg-amber-500/5 rounded-xl border border-amber-500/30 p-6">
          <h3 className="text-lg font-semibold text-amber-400 mb-3">
            ⚠ Existing Products Found ({existingMatches.length})
          </h3>
          <p className="text-sm text-muted mb-4">
            These products already exist with similar details. Open one to edit it, or merge duplicates below.
          </p>
          <div className="space-y-2 mb-4">
            {existingMatches.map((match) => (
              <div key={match.id} className="flex items-center justify-between bg-surface-2 rounded-lg p-3 text-sm">
                <div>
                  <span className="font-medium text-foreground">{match.brand} {match.model}</span>
                  <span className="text-muted ml-2">({match.category})</span>
                  {match.sku && <span className="text-muted ml-2">SKU: {match.sku}</span>}
                  {match.vendorPartNumber && <span className="text-muted ml-2">VP#: {match.vendorPartNumber}</span>}
                  <span className="ml-2 text-xs">
                    {match.hubspotProductId ? "✓HS" : "—"} {match.zuperItemId ? "✓ZP" : "—"} {match.zohoItemId ? "✓ZO" : "—"}
                  </span>
                </div>
                <a href={`/dashboards/catalog/${match.id}`} target="_blank" className="text-cyan-400 hover:underline text-xs">
                  Open Existing →
                </a>
              </div>
            ))}
          </div>

          {/* Merge tool (same as current form) */}
          {existingMatches.length >= 2 && (
            <div className="border-t border-amber-500/20 pt-4 space-y-2">
              <p className="text-xs font-medium text-muted">Merge Duplicates</p>
              <div className="flex gap-2 items-end flex-wrap">
                <select value={mergeSourceSkuId} onChange={(e) => setMergeSourceSkuId(e.target.value)} className="rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-xs">
                  <option value="">Source (will be removed)</option>
                  {existingMatches.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.model}</option>)}
                </select>
                <span className="text-xs text-muted">→</span>
                <select value={mergeTargetSkuId} onChange={(e) => setMergeTargetSkuId(e.target.value)} className="rounded-lg border border-t-border bg-surface-2 px-2 py-1.5 text-xs">
                  <option value="">Target (keep)</option>
                  {existingMatches.map((m) => <option key={m.id} value={m.id}>{m.brand} {m.model}</option>)}
                </select>
                <button onClick={handleMerge} disabled={mergeBusy || !mergeSourceSkuId || !mergeTargetSkuId || mergeSourceSkuId === mergeTargetSkuId} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50">
                  {mergeBusy ? "Merging..." : "Merge"}
                </button>
              </div>
              {mergeMessage && <p className="text-xs text-muted">{mergeMessage}</p>}
            </div>
          )}
        </div>
      )}
      {existingMatchesLoading && <p className="text-xs text-muted animate-pulse">Checking for existing products...</p>}

      {/* Confidence banner for prefilled */}
      {state.prefillSource && state.prefillFields.size > 0 && (
        <div className={`rounded-lg p-3 text-sm ${
          state.prefillSource === "clone"
            ? "bg-green-500/10 border border-green-500/30 text-green-400"
            : "bg-blue-500/10 border border-blue-500/30 text-blue-400"
        }`}>
          {state.prefillSource === "clone"
            ? `Cloned from existing product. ${state.prefillFields.size} fields pre-filled.`
            : `Extracted from datasheet. ${state.prefillFields.size} fields pre-filled. Please review highlighted values.`
          }
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canProceed}
          onClick={onNext}
          className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Next: Details →
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
git add src/components/catalog/BasicsStep.tsx
git commit -m "feat(catalog): add basics step with duplicate check and prefill highlights"
```

---

## Task 8: Details Step Component (+ CategoryFields tooltip enhancement)

**Files:**
- Create: `src/components/catalog/DetailsStep.tsx`
- Modify: `src/components/catalog/CategoryFields.tsx` — add `showTooltips` and `prefillFields` props, render `FieldTooltip` per dynamic field using `FieldDef.description`
- Modify: `src/lib/catalog-fields.ts` — add `description` strings to any `FieldDef` entries that lack them

**Step 1: Write DetailsStep**

Renders category specs (via **enhanced** `CategoryFields` with per-field tooltips), pricing, dimensions, vendor info. All fields optional. Each has help tooltip. "Skip to Review" link.

**Note on CategoryFields enhancement:** The existing `CategoryFields.tsx` renders dynamic fields from `getCategoryFields()` but has no tooltip support. This task also modifies `CategoryFields.tsx` to accept an optional `showTooltips` prop and renders `FieldTooltip` next to each dynamic field label using the `description` from `FieldDef` (already present in `catalog-fields.ts`). Add `description` strings to any `FieldDef` entries in `catalog-fields.ts` that lack them (e.g., "Cell Type" → "Monocrystalline, polycrystalline, or thin-film", "Efficiency %" → "Rated module efficiency as a percentage").

```tsx
// src/components/catalog/DetailsStep.tsx
"use client";
import CategoryFields from "./CategoryFields";
import FieldTooltip from "./FieldTooltip";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface DetailsStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onNext: () => void;
  onBack: () => void;
}

function OptionalBadge() {
  return <span className="text-[10px] text-muted ml-1">(optional)</span>;
}

export default function DetailsStep({ state, dispatch, onNext, onBack }: DetailsStepProps) {
  const isPrefilled = (field: string) => state.prefillFields.has(field);
  const fieldClass = (field: string) =>
    `${isPrefilled(field) ? "border-l-2 border-l-blue-400 pl-3" : ""}`;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        These fields are optional — fill what you have, skip the rest.
      </p>

      {/* Category Specs */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Category Specifications <OptionalBadge />
        </h3>
        <CategoryFields
          category={state.category}
          values={state.specValues}
          onChange={(key, value) => dispatch({ type: "SET_SPEC", key, value })}
          showTooltips={true}
          prefillFields={state.prefillFields}
        />
      </div>

      {/* Pricing */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Pricing & Unit <OptionalBadge />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={fieldClass("unitCost")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Cost ($)
              <FieldTooltip text="Your cost to purchase this item from the vendor" />
            </label>
            <input
              type="number"
              step="any"
              value={state.unitCost}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "unitCost", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("sellPrice")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Sell Price ($)
              <FieldTooltip text="The price charged to the customer" />
            </label>
            <input
              type="number"
              step="any"
              value={state.sellPrice}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "sellPrice", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("unitSpec")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Spec
              <FieldTooltip text="The primary numeric rating (e.g., 400 for a 400W module, 13.5 for a 13.5kWh battery)" />
            </label>
            <input
              type="number"
              step="any"
              value={state.unitSpec}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "unitSpec", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("unitLabel")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Unit Label
              <FieldTooltip text="Unit of measurement for the spec (e.g., W, kWh, kW, A)" />
            </label>
            <input
              type="text"
              value={state.unitLabel}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "unitLabel", value: e.target.value })}
              placeholder="W, kWh, kW, A..."
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
        </div>
      </div>

      {/* Physical & Vendor */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">
          Physical Details & Vendor <OptionalBadge />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className={fieldClass("length")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Length (in)
              <FieldTooltip text="Product length in inches" />
            </label>
            <input
              type="number"
              step="any"
              value={state.length}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "length", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("width")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Width (in)
              <FieldTooltip text="Product width in inches" />
            </label>
            <input
              type="number"
              step="any"
              value={state.width}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "width", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("weight")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Weight (lbs)
              <FieldTooltip text="Product weight in pounds" />
            </label>
            <input
              type="number"
              step="any"
              value={state.weight}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "weight", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("sku")}>
            <label className="block text-sm font-medium text-muted mb-1">
              SKU
              <FieldTooltip text="Internal product SKU for tracking" />
            </label>
            <input
              type="text"
              value={state.sku}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "sku", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("vendorName")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Vendor Name
              <FieldTooltip text="Distributor or supplier name (e.g., CED, BayWa)" />
            </label>
            <input
              type="text"
              value={state.vendorName}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "vendorName", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className={fieldClass("vendorPartNumber")}>
            <label className="block text-sm font-medium text-muted mb-1">
              Vendor Part #
              <FieldTooltip text="The part number used by the vendor/distributor" />
            </label>
            <input
              type="text"
              value={state.vendorPartNumber}
              onChange={(e) => dispatch({ type: "SET_FIELD", field: "vendorPartNumber", value: e.target.value })}
              className="w-full rounded-lg border border-t-border bg-surface-2 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
        </div>

        {/* Hard to Procure */}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={state.hardToProcure}
            onClick={() => dispatch({ type: "SET_FIELD", field: "hardToProcure", value: !state.hardToProcure })}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              state.hardToProcure ? "bg-amber-500" : "bg-surface-2"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                state.hardToProcure ? "translate-x-5" : ""
              }`}
            />
          </button>
          <span className="text-sm text-muted">
            Hard to Procure
            <FieldTooltip text="Flag if lead times exceed 4+ weeks — affects project scheduling estimates" />
          </span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onNext}
            className="text-sm text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
          >
            Skip to Review
          </button>
          <button
            type="button"
            onClick={onNext}
            className="px-6 py-2.5 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-colors"
          >
            Next: Review →
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
git add src/components/catalog/DetailsStep.tsx
git commit -m "feat(catalog): add details step with tooltips, optional badges, and skip link"
```

---

## Task 9: Review Step Component

**Files:**
- Create: `src/components/catalog/ReviewStep.tsx`

**Step 1: Write ReviewStep**

Read-only summary of all fields, system checkboxes, sanity warnings, submit button.

```tsx
// src/components/catalog/ReviewStep.tsx
"use client";
import { getCategoryLabel, getCategoryFields, CATEGORY_DEFAULTS } from "@/lib/catalog-fields";
import type { CatalogFormState, CatalogFormAction } from "@/lib/catalog-form-state";

interface ReviewStepProps {
  state: CatalogFormState;
  dispatch: React.Dispatch<CatalogFormAction>;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-t-border/50 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`text-sm font-medium ${value ? "text-foreground" : "text-muted/50"}`}>
        {value || "—"}
      </span>
    </div>
  );
}

const SYSTEM_OPTIONS = ["HUBSPOT", "ZUPER", "ZOHO"] as const;

export default function ReviewStep({ state, dispatch, onBack, onSubmit, submitting, error }: ReviewStepProps) {
  const warnings: string[] = [];
  if (state.unitCost && state.sellPrice) {
    const cost = parseFloat(state.unitCost);
    const sell = parseFloat(state.sellPrice);
    if (sell < cost) warnings.push("Sell price is lower than unit cost.");
  }

  const specFields = getCategoryFields(state.category);

  return (
    <div className="space-y-6">
      {/* Product Summary */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Product Summary</h3>
        <Row label="Category" value={getCategoryLabel(state.category) || state.category} />
        <Row label="Brand" value={state.brand} />
        <Row label="Model" value={state.model} />
        <Row label="Description" value={state.description} />
        <Row label="SKU" value={state.sku} />
        <Row label="Vendor" value={state.vendorName} />
        <Row label="Vendor Part #" value={state.vendorPartNumber} />
      </div>

      {/* Specs */}
      {specFields.length > 0 && (
        <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Specifications</h3>
          {specFields.map((f) => (
            <Row
              key={f.key}
              label={f.label}
              value={
                state.specValues[f.key] !== undefined && state.specValues[f.key] !== ""
                  ? `${state.specValues[f.key]}${f.unit ? ` ${f.unit}` : ""}`
                  : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Pricing & Physical */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Pricing & Physical</h3>
        <Row label="Unit Cost" value={state.unitCost ? `$${state.unitCost}` : undefined} />
        <Row label="Sell Price" value={state.sellPrice ? `$${state.sellPrice}` : undefined} />
        <Row label="Unit Spec" value={state.unitSpec ? `${state.unitSpec} ${state.unitLabel}` : undefined} />
        <Row label="Dimensions" value={state.length || state.width ? `${state.length || "—"} × ${state.width || "—"} in` : undefined} />
        <Row label="Weight" value={state.weight ? `${state.weight} lbs` : undefined} />
        <Row label="Hard to Procure" value={state.hardToProcure ? "Yes" : "No"} />
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-400">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Systems */}
      <div className="bg-surface rounded-xl border border-t-border p-6 shadow-card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Push to Systems</h3>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked disabled className="rounded" />
            Internal (always)
          </label>
          {SYSTEM_OPTIONS.map((sys) => (
            <label key={sys} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={state.systems.has(sys)}
                onChange={() => dispatch({ type: "TOGGLE_SYSTEM", system: sys })}
                className="rounded"
              />
              {sys.charAt(0) + sys.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
        >
          ← Back to Details
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={onSubmit}
          className="px-8 py-3 text-sm font-semibold rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Submitting..." : "Submit for Approval"}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```
git add src/components/catalog/ReviewStep.tsx
git commit -m "feat(catalog): add review step with summary, sanity warnings, and system toggles"
```

---

## Task 10: Rewrite page.tsx as Wizard Shell

**Files:**
- Modify: `src/app/dashboards/catalog/new/page.tsx` (full rewrite)

**Step 1: Rewrite the page**

Replace the 660-line single-page form with a thin wizard shell that renders step components. Keeps the existing `handleSubmit` payload structure and success screen. Uses the reducer from Task 1.

The page should:
1. Import `useReducer` with `catalogFormReducer` and `initialFormState`
2. Track `currentStep` as state (`"start" | "basics" | "details" | "review"`)
3. Render `WizardProgress` at top
4. Render the active step component
5. Handle `onSubmit` with the same POST payload structure as today (lines 209–228 of original)
6. Show same success screen on completion
7. Apply `CATEGORY_DEFAULTS` when category is selected (unit label + system defaults)
8. Handle clone prefill: map `CloneResult` to `PREFILL_FROM_PRODUCT` action
9. Handle datasheet prefill: map extraction result to `PREFILL_FROM_PRODUCT` action
10. **Preserve URL query-param prefills from deal/BOM flows** — read `searchParams` for `category`, `brand`, `model`, `description`, `unitSpec`, `unitLabel` on mount, dispatch `SET_FIELD` for each present param, and auto-skip to the "basics" step if any are provided (same behavior as current page.tsx lines 69-82)

Keep `DashboardShell` wrapper with same props (title="Submit New Product", accentColor="cyan").

**Step 2: Run the dev server and verify**

Run: `npm run dev`
Navigate to `/dashboards/catalog/new`
Verify: progress bar shows, Start Mode step renders 3 cards, clicking "Start from Scratch" goes to Basics step, filling 4 required fields enables Next, Details step shows all optional fields with tooltips, Review step shows summary, submit works.

**Step 3: Commit**

```
git add src/app/dashboards/catalog/new/page.tsx
git commit -m "feat(catalog): rewrite product form as 4-step wizard with clone and AI import"
```

---

## Task 11: Tests — Reducer Unit + Wizard Flow Coverage

**Files:**
- Create: `src/__tests__/lib/catalog-form-state.test.ts` (if not already from Task 1)
- Create: `src/__tests__/app/catalog-new-wizard.test.ts`

**Step 1: Reducer unit tests (exhaustive)**

Cover all action types in the reducer — these are fast, pure-function tests:

```typescript
import { catalogFormReducer, initialFormState } from "@/lib/catalog-form-state";

describe("catalogFormReducer", () => {
  it("produces correct payload from completed wizard state", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_CATEGORY", category: "MODULE" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Hanwha" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "model", value: "Q.PEAK 400" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "description", value: "400W Module" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "unitCost", value: "150" });
    state = catalogFormReducer(state, { type: "SET_SPEC", key: "wattage", value: 400 });
    state = catalogFormReducer(state, { type: "TOGGLE_SYSTEM", system: "HUBSPOT" });

    expect(state.category).toBe("MODULE");
    expect(state.brand).toBe("Hanwha");
    expect(state.model).toBe("Q.PEAK 400");
    expect(state.specValues).toEqual({ wattage: 400 });
    expect(state.systems.has("INTERNAL")).toBe(true);
    expect(state.systems.has("HUBSPOT")).toBe(true);
    expect(state.unitCost).toBe("150");
  });

  it("PREFILL_FROM_PRODUCT populates all fields and tracks prefill source", () => {
    const cloneData = {
      category: "BATTERY", brand: "Tesla", model: "Powerwall 3",
      description: "13.5 kWh battery", unitSpec: "13.5", unitLabel: "kWh",
      unitCost: "8500", sellPrice: "12000", photoUrl: "https://blob.example/photo.jpg",
      specValues: { capacity: 13.5 },
    };
    const state = catalogFormReducer(initialFormState, {
      type: "PREFILL_FROM_PRODUCT", data: cloneData, source: "clone",
    });
    expect(state.brand).toBe("Tesla");
    expect(state.photoUrl).toBe("https://blob.example/photo.jpg");
    expect(state.prefillSource).toBe("clone");
    expect(state.prefillFields.has("brand")).toBe(true);
  });

  it("SET_CATEGORY resets specValues but preserves other fields", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Enphase" });
    state = catalogFormReducer(state, { type: "SET_SPEC", key: "wattage", value: 400 });
    state = catalogFormReducer(state, { type: "SET_CATEGORY", category: "INVERTER" });
    expect(state.specValues).toEqual({});
    expect(state.brand).toBe("Enphase"); // preserved
  });

  it("SET_FIELD for photoUrl and photoFileName", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "photoUrl", value: "https://blob/photo.jpg" });
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "photoFileName", value: "photo.jpg" });
    expect(state.photoUrl).toBe("https://blob/photo.jpg");
    expect(state.photoFileName).toBe("photo.jpg");
  });

  it("RESET returns to initial state", () => {
    let state = initialFormState;
    state = catalogFormReducer(state, { type: "SET_FIELD", field: "brand", value: "Hanwha" });
    state = catalogFormReducer(state, { type: "RESET" });
    expect(state).toEqual(initialFormState);
  });
});
```

**Step 2: API route tests (clone search, photo upload, extraction)**

Test the search and photo upload endpoints for auth enforcement and correct responses:

```typescript
// src/__tests__/app/catalog-search-api.test.ts
// Mock prisma, requireApiAuth — test that:
// - Unauthenticated requests return 401
// - Short queries return []
// - Valid queries call prisma.equipmentSku.findMany with correct includes (spec relations)
// - Results include sync status fields (hubspotProductId, zuperItemId, zohoItemId, photoUrl)

// src/__tests__/app/catalog-photo-upload.test.ts
// Mock @vercel/blob, requireApiAuth — test that:
// - Unauthenticated requests return 401
// - Non-image files return 400
// - Oversized files return 400
// - Valid upload returns { url, fileName }
// - Filename is sanitized (no path traversal characters)
```

**Step 3: Wizard flow validation (query-param prefill)**

```typescript
// src/__tests__/app/catalog-wizard-prefill.test.ts
// Test that URL search params are read and dispatched as SET_FIELD actions.
// This can be a pure unit test: given params { brand: "Hanwha", model: "Q.PEAK" },
// assert that the resulting state has those fields populated and currentStep === "basics" (skipped start).
```

**Step 2: Run tests**

Run: `npm test -- --testPathPattern=catalog`
Expected: all tests PASS

**Step 3: Commit**

```
git add src/__tests__/app/catalog-new-wizard.test.ts
git commit -m "test(catalog): add wizard integration test"
```

---

## Task 12: Final Verification & Push

**Step 1: Run full lint**

Run: `npm run lint`
Expected: no new errors

**Step 2: Run full build**

Run: `npm run build`
Expected: build succeeds

**Step 3: Visual verification**

Start dev server, navigate through all wizard steps, verify:
- Start Mode: 3 cards render
- Clone: search works, pre-fills with green highlights
- Basics: category grid, brand dropdown, duplicate check
- Details: tooltips show, skip link works
- Review: summary correct, sanity warning on bad pricing
- Submit: POST succeeds, success screen shows

**Step 4: Push**

```
git push
```

---

## Task 13: Product Photo Upload on Details Step

**Files:**
- Create: `src/components/catalog/PhotoUpload.tsx`
- Create: `src/app/api/catalog/upload-photo/route.ts`
- Modify: `src/components/catalog/DetailsStep.tsx` — add PhotoUpload section
- Modify: `src/lib/catalog-form-state.ts` — add `photoUrl` and `photoFileName` to state

**Step 1: Install Vercel Blob**

Run: `npm install @vercel/blob`

**Step 2: Add `photoUrl` to Prisma schema**

Add `photoUrl String?` to both `EquipmentSku` and `PendingCatalogPush` models. This ensures the photo persists on the canonical SKU record after approval, not just on the pending push.

```prisma
// In model EquipmentSku, after zohoItemId:
photoUrl    String?           // Vercel Blob URL for product photo

// In model PendingCatalogPush, in the metadata section:
photoUrl    String?           // Photo uploaded during submission
```

Run: `npx prisma migrate dev --name add-photo-url`

**Step 3: Add photo fields to form state**

In `src/lib/catalog-form-state.ts`, add to `CatalogFormState`:

```typescript
photoUrl: string;       // Vercel Blob URL after upload
photoFileName: string;  // Original filename for display
```

Initialize both as `""` in `initialFormState`. Handle in `SET_FIELD` action (already works). Add to `PREFILL_FROM_PRODUCT` handling (clone copies `photoUrl` from the EquipmentSku record returned by the search API; datasheet leaves blank).

**Step 4: Write upload API route (with auth)**

```typescript
// src/app/api/catalog/upload-photo/route.ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireApiAuth } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  // Auth guard — same pattern as bom/upload and solar/upload routes
  const authResult = await requireApiAuth();
  if (authResult instanceof NextResponse) return authResult;

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate: images only, max 5MB
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only JPEG, PNG, and WebP images are allowed" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be under 5MB" }, { status: 400 });
  }

  // Sanitize filename to prevent path traversal
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const blob = await put(`catalog-photos/${Date.now()}-${safeName}`, file, {
    access: "public",
  });

  return NextResponse.json({ url: blob.url, fileName: file.name });
}
```

**Step 4: Write PhotoUpload component**

Drag-and-drop zone that uploads to `/api/catalog/upload-photo`, shows thumbnail preview after upload, with a remove button. Dispatches `SET_FIELD` for `photoUrl` and `photoFileName`.

**Step 5: Add PhotoUpload to DetailsStep**

Add a "Product Photo (optional)" section at the bottom of DetailsStep, before the Hard to Procure toggle.

**Step 6: Commit**

```
git add src/components/catalog/PhotoUpload.tsx src/app/api/catalog/upload-photo/route.ts src/components/catalog/DetailsStep.tsx src/lib/catalog-form-state.ts
git commit -m "feat(catalog): add product photo upload with Vercel Blob storage"
```

---

## Task 14: Zoho Photo Sync on Approval

**Files:**
- Modify: `src/lib/zoho-inventory.ts` — add `uploadZohoItemImage()` function
- Modify: `src/app/api/catalog/push-requests/[id]/approve/route.ts` — call image upload after Zoho upsert
- Modify: `src/app/api/catalog/push-requests/route.ts` — persist `photoUrl` on PendingCatalogPush

**Step 1: Add photoUrl to push request creation and approval**

In `src/app/api/catalog/push-requests/route.ts`, add `photoUrl` to the `prisma.pendingCatalogPush.create()` data. The field was added in the Task 13 migration.

In `src/app/api/catalog/push-requests/[id]/approve/route.ts`, when creating/updating the `EquipmentSku`, include `photoUrl: push.photoUrl` so the photo persists on the canonical record after approval (not just on the pending push). This is the authoritative source for clone operations.

**Step 2: Write Zoho image upload function**

```typescript
// In src/lib/zoho-inventory.ts, add:
export async function uploadZohoItemImage(
  zohoItemId: string,
  imageUrl: string
): Promise<{ success: boolean; error?: string }> {
  // 1. Fetch image from Vercel Blob URL
  // 2. POST to Zoho Inventory API: /items/{item_id}/image
  //    Content-Type: multipart/form-data with the image file
  // 3. Return success/error
}
```

Zoho Inventory API endpoint: `POST /api/v1/items/{item_id}/image`
Accepts multipart form data with an `image` field.

**Step 3: Call image upload after Zoho upsert in approval route**

In the approval route, after `upsertZohoItem` succeeds and returns a `zohoItemId`, check if `push.photoUrl` exists. If so, call `uploadZohoItemImage(zohoItemId, push.photoUrl)`. This is fire-and-forget — log errors but don't fail the approval.

**Step 4: Commit**

```
git add src/lib/zoho-inventory.ts src/app/api/catalog/push-requests/[id]/approve/route.ts src/app/api/catalog/push-requests/route.ts
git commit -m "feat(catalog): sync product photo to Zoho Inventory on approval"
```
