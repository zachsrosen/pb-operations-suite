/**
 * Solar Surveyor — Equipment Profile Zod Schemas
 *
 * Category-specific validation schemas for custom equipment profiles.
 * Shared between POST (create) and PUT (update) equipment routes.
 */

import { z } from "zod";
import {
  canonicalizeEquipmentKey,
  RESERVED_KEY_PREFIXES,
} from "@/lib/solar/types";

// ── Key canonicalization ─────────────────────────────────────

export const canonicalizeKeyTransform = z
  .string()
  .min(3)
  .max(100)
  .transform(canonicalizeEquipmentKey)
  .refine((k) => k.length >= 3, { message: "Key too short after canonicalization" })
  .refine(
    (k) => !RESERVED_KEY_PREFIXES.some((p) => k.startsWith(p)),
    { message: "Key uses a reserved prefix" }
  );

// ── Profile schemas per category ─────────────────────────────

export const PanelProfileSchema = z.object({
  name: z.string().min(1).max(200),
  manufacturer: z.string().max(200).optional(),
  watts: z.number().positive(),
  voc: z.number().positive(),
  vmp: z.number().positive(),
  isc: z.number().positive(),
  imp: z.number().positive(),
  tempCoVoc: z.number(),
  tempCoIsc: z.number(),
  tempCoPmax: z.number(),
  length: z.number().positive(), // mm
  width: z.number().positive(), // mm
  cells: z.number().int().positive(),
  bypassDiodes: z.number().int().positive(),
  cellsPerSubstring: z.number().int().positive(),
  isBifacial: z.boolean().optional(),
  bifacialityFactor: z.number().min(0).max(1).optional(),
});

export const InverterProfileSchema = z.object({
  name: z.string().min(1).max(200),
  manufacturer: z.string().max(200).optional(),
  maxPowerW: z.number().positive(),
  maxVdc: z.number().positive(),
  mpptMin: z.number().positive(),
  mpptMax: z.number().positive(),
  mpptChannels: z.number().int().positive(),
  maxIsc: z.number().positive(),
  nominalVac: z.number().positive(),
  maxEfficiency: z.number().min(0).max(1),
  type: z.enum(["string", "micro", "hybrid"]),
});

export const EssProfileSchema = z.object({
  name: z.string().min(1).max(200),
  manufacturer: z.string().max(200).optional(),
  capacityKwh: z.number().positive(),
  maxChargeKw: z.number().positive(),
  maxDischargeKw: z.number().positive(),
  roundTripEfficiency: z.number().min(0).max(1),
  depthOfDischarge: z.number().min(0).max(1),
  nominalVoltage: z.number().positive(),
});

export const OptimizerProfileSchema = z.object({
  name: z.string().min(1).max(200),
  manufacturer: z.string().max(200).optional(),
  maxInputW: z.number().positive(),
  maxInputVoc: z.number().positive(),
  maxOutputVdc: z.number().positive(),
  maxOutputIsc: z.number().positive(),
  mpptRange: z.tuple([z.number().positive(), z.number().positive()]),
});

export const PROFILE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  PANEL: PanelProfileSchema,
  INVERTER: InverterProfileSchema,
  ESS: EssProfileSchema,
  OPTIMIZER: OptimizerProfileSchema,
};
