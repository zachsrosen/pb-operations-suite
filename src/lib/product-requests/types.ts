import type { AdderCategory, AdderUnit } from "@/generated/prisma/enums";

export type EquipmentRequestPayload = {
  category: string;
  brand: string;
  model: string;
  datasheetUrl?: string | null;
  salesRequestNote: string;
  dealId?: string | null;
  extractedMetadata?: Record<string, unknown> | null;
};

export type AdderRequestPayload = {
  category: AdderCategory;
  unit: AdderUnit;
  name: string;
  estimatedPrice?: number | null;
  description?: string | null;
  salesRequestNote: string;
  dealId?: string | null;
};

export type MergedRequestRow = {
  id: string;
  type: "EQUIPMENT" | "ADDER";
  status: string;
  title: string;
  requestedBy: string;
  createdAt: string;
  dealId: string | null;
  salesRequestNote: string | null;
  // Rep-entered estimates surfaced to the reviewer to pre-fill approval forms.
  estimatedPrice: number | null;
  estimatedCost: number | null;
};
