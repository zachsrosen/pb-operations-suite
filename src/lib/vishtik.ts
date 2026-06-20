// src/lib/vishtik.ts
export const VISHTIK_BASE = "https://project.vishtik.com";

export interface VishtikProject {
  vishtikId: string;
  projNumber: string | null;
  customerName: string;
  status: string;
}

export function parseProjNumber(customerName: string): string | null {
  const m = (customerName || "").match(/PROJ-\d+/);
  return m ? m[0] : null;
}

export function detailUrl(vishtikId: string): string {
  return `${VISHTIK_BASE}/Project/Project/Project-Details?id=${vishtikId}`;
}
