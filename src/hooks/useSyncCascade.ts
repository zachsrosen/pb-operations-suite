// src/hooks/useSyncCascade.ts

import { useCallback, useEffect, useRef } from "react";
import type {
  ExternalSystem,
  FieldIntent,
  FieldMappingEdge,
  FieldValueSnapshot,
  NormalizeWith,
} from "@/lib/catalog-sync-types";
import { EXTERNAL_SYSTEMS } from "@/lib/catalog-sync-types";

type IntentsMap = Record<ExternalSystem, Record<string, FieldIntent>>;

interface UseSyncCascadeOptions {
  mappings: FieldMappingEdge[];
  snapshots: FieldValueSnapshot[];
}

/** Manages auto-cascade logic: when a field becomes pull/manual,
 *  sibling fields on other systems auto-set to push or skip. */
export function useSyncCascade({ mappings, snapshots }: UseSyncCascadeOptions) {
  // Refs keep applyCascade's closure fresh without changing its identity
  const mappingsRef = useRef(mappings);
  useEffect(() => { mappingsRef.current = mappings; });
  const snapshotsRef = useRef(snapshots);
  useEffect(() => { snapshotsRef.current = snapshots; });

  /** Run cascade logic over the full intent map. Returns a new intents object. */
  const applyCascade = useCallback(
    (intents: IntentsMap): IntentsMap => {
      const result = structuredClone(intents);
      const m = mappingsRef.current;
      const s = snapshotsRef.current;

      // Find all active pulls
      const activePulls: Array<{
        system: ExternalSystem;
        externalField: string;
        internalField: string;
        rawValue: string | number | null;
      }> = [];

      for (const system of EXTERNAL_SYSTEMS) {
        for (const [field, intent] of Object.entries(result[system] ?? {})) {
          if (intent.direction !== "pull") continue;
          const edge = m.find(
            (e) => e.system === system && e.externalField === field,
          );
          if (!edge) continue;
          const snap = s.find(
            (sn) => sn.system === system && sn.field === field,
          );
          activePulls.push({
            system,
            externalField: field,
            internalField: edge.internalField,
            rawValue: snap?.rawValue ?? null,
          });
        }
      }

      // Build effective internal values from pulls
      const effectiveValues = new Map<string, string | number | null>();
      for (const pull of activePulls) {
        effectiveValues.set(pull.internalField, pull.rawValue);
      }

      // For fields still without a pull, use the internal snapshot
      for (const snap of s) {
        if (snap.system === "internal" && !effectiveValues.has(snap.field)) {
          effectiveValues.set(snap.field, snap.rawValue);
        }
      }

      // Cascade: for each auto-mode field on non-pulling systems, set push or skip
      for (const system of EXTERNAL_SYSTEMS) {
        for (const [field, intent] of Object.entries(result[system] ?? {})) {
          if (intent.mode !== "auto") continue;
          const edge = m.find(
            (e) => e.system === system && e.externalField === field,
          );
          if (!edge) continue;

          const effectiveValue = effectiveValues.get(edge.internalField);
          const externalSnap = s.find(
            (sn) => sn.system === system && sn.field === field,
          );

          // Compare effective value with external current
          const effectiveNorm = normalizeForCompare(
            effectiveValue,
            edge.normalizeWith,
          );
          const externalNorm = normalizeForCompare(
            externalSnap?.rawValue,
            edge.normalizeWith,
          );

          const hasDiff = effectiveNorm !== externalNorm;
          result[system][field] = {
            ...intent,
            direction: hasDiff ? "push" : "skip",
          };
        }
      }

      return result;
    },
    [],
  );

  return { applyCascade };
}

function normalizeForCompare(
  value: unknown,
  method: NormalizeWith,
): string {
  if (value === null || value === undefined) return "__null__";
  switch (method) {
    case "number": {
      const n = parseFloat(String(value));
      return Number.isFinite(n) ? String(n) : "__null__";
    }
    case "enum-ci":
      return String(value).trim().toLowerCase();
    default:
      return String(value).trim();
  }
}
