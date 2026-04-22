// Serialized shape of Adder + overrides for client transfer.
// Decimal columns become strings; Date columns become ISO strings.

import type {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
} from "@/generated/prisma/enums";

export type SerializedShopOverride = {
  id: string;
  adderId: string;
  shop: string;
  priceDelta: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SerializedAdder = {
  id: string;
  code: string;
  name: string;
  category: AdderCategory;
  type: AdderType;
  direction: AdderDirection;
  autoApply: boolean;
  appliesTo: string | null;
  triggerCondition: string | null;
  triageQuestion: string | null;
  triageAnswerType: TriageAnswerType | null;
  triageChoices: unknown;
  triggerLogic: unknown;
  photosRequired: boolean;
  unit: AdderUnit;
  basePrice: string;
  baseCost: string;
  marginTarget: string | null;
  active: boolean;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  openSolarId: string | null;
  overrides: SerializedShopOverride[];
};

export type SerializedAdderRevision = {
  id: string;
  adderId: string;
  snapshot: unknown;
  changedBy: string;
  changeNote: string | null;
  changedAt: string;
};
