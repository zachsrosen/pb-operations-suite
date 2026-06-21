// src/lib/vishtik-sync.ts
import type { VishtikProject } from "@/lib/vishtik";

export type Match =
  | { kind: "single"; vishtikId: string }
  | { kind: "ambiguous"; candidateIds: string[] }
  | { kind: "none" };

export function buildProjIndex(projects: VishtikProject[]): Map<string, VishtikProject[]> {
  const idx = new Map<string, VishtikProject[]>();
  for (const p of projects) {
    if (!p.projNumber) continue;
    const arr = idx.get(p.projNumber) ?? [];
    arr.push(p);
    idx.set(p.projNumber, arr);
  }
  return idx;
}

export function classifyMatch(idx: Map<string, VishtikProject[]>, projNumber: string): Match {
  const hits = idx.get(projNumber) ?? [];
  if (hits.length === 1) return { kind: "single", vishtikId: hits[0].vishtikId };
  if (hits.length > 1) return { kind: "ambiguous", candidateIds: hits.map((h) => h.vishtikId) };
  return { kind: "none" };
}
