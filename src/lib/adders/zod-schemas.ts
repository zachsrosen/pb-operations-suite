import { z } from "zod";
import {
  AdderCategory,
  AdderUnit,
  AdderType,
  AdderDirection,
  TriageAnswerType,
} from "@/generated/prisma";
import { parseAppliesTo } from "./applies-to";

// Validates the SHAPE of the triggerLogic JSON at the API boundary per spec.
// Semantic validity (that the predicate actually evaluates against the
// triageAnswerType) is enforced at triage recommendation time in Chunk 3
// — a shape-valid predicate with a mismatched answer type returns no match
// rather than a 500. This is intentional: shape validation here is cheap;
// semantic checks need the answer context.
export const TriggerLogicSchema = z.object({
  op: z.enum(["lt", "lte", "eq", "gte", "gt", "contains", "truthy"]),
  value: z.union([z.number(), z.string(), z.boolean()]).optional(),
  qtyFrom: z.enum(["answer", "constant"]).optional(),
  qtyConstant: z.number().optional(),
}).refine(
  (v) => v.op === "truthy" || v.value !== undefined,
  { message: "value is required except when op is 'truthy'" }
);

const AppliesToString = z
  .string()
  .optional()
  .nullable()
  .refine(
    (v) => {
      if (!v) return true;
      try {
        parseAppliesTo(v);
        return true;
      } catch {
        return false;
      }
    },
    { message: "invalid appliesTo syntax; see spec for supported grammar" }
  );

export const CreateAdderSchema = z.object({
  code: z.string().min(1).regex(/^[A-Z0-9_]+$/, "code must be UPPER_SNAKE"),
  name: z.string().min(1),
  category: z.nativeEnum(AdderCategory),
  type: z.nativeEnum(AdderType).default("FIXED"),
  direction: z.nativeEnum(AdderDirection).default("ADD"),
  autoApply: z.boolean().default(false),
  appliesTo: AppliesToString,
  triggerCondition: z.string().nullable().optional(),
  triageQuestion: z.string().nullable().optional(),
  triageAnswerType: z.nativeEnum(TriageAnswerType).nullable().optional(),
  triageChoices: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) })).nullable().optional(),
  triggerLogic: TriggerLogicSchema.nullable().optional(),
  photosRequired: z.boolean().default(false),
  unit: z.nativeEnum(AdderUnit),
  basePrice: z.number().nonnegative(),
  baseCost: z.number().nonnegative(),
  marginTarget: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateAdderInput = z.infer<typeof CreateAdderSchema>;

export const ShopOverrideSchema = z.object({
  shop: z.string().min(1),
  priceDelta: z.number(),
  active: z.boolean().default(true),
});

export const UpdateAdderSchema = CreateAdderSchema.partial().extend({
  // `active` is only settable on update (create defaults to true in DB).
  // retireAdder uses this to flip the row to inactive.
  active: z.boolean().optional(),
  changeNote: z.string().optional(),
  overrides: z.array(ShopOverrideSchema).optional(),
});

export type UpdateAdderInput = z.infer<typeof UpdateAdderSchema>;
