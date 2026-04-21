import { z } from "zod";

export const AddressPartsSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state: z.string().length(2),
  zip: z.string().min(5).max(10),
  unit: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  formatted: z.string().optional(),
  normalizedHash: z.string().optional(),
});

export const ShadeBucketSchema = z.enum(["light", "moderate", "heavy"]);
export const RoofTypeSchema = z.enum(["asphalt_shingle", "tile", "metal", "flat_tpo", "other"]);
export const LocationSchema = z.enum(["DTC", "WESTY", "COSP", "CA", "CAMARILLO"]);
export const QuoteTypeSchema = z.enum(["new_install"]);

export const UsageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bill"), avgMonthlyBillUsd: z.number().positive().max(100000) }),
  z.object({ kind: z.literal("kwh"), avgMonthlyKwh: z.number().positive().max(200000) }),
]);

export const ConsiderationsSchema = z.object({
  planningEv: z.boolean(),
  needsPanelUpgrade: z.boolean(),
  planningHotTub: z.boolean(),
  mayNeedNewRoof: z.boolean(),
});

export const AddOnSelectionsSchema = z.object({
  evCharger: z.boolean(),
  panelUpgrade: z.boolean(),
});

export const ContactInfoSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255),
  phone: z.string().min(7).max(30),
  referredBy: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

// Client-facing request for /api/estimator/quote
// The quote endpoint accepts user-facing fields and resolves engine internals server-side.
export const QuoteRequestSchema = z.object({
  address: AddressPartsSchema,
  location: LocationSchema,
  utilityId: z.string().min(1),
  usage: UsageSchema,
  home: z.object({
    roofType: RoofTypeSchema,
    shade: ShadeBucketSchema,
    heatPump: z.boolean(),
  }),
  considerations: ConsiderationsSchema,
  addOns: AddOnSelectionsSchema,
});

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export const SubmitKindSchema = z.enum(["quote", "out_of_area", "manual_quote_request"]);

export const QuoteSubmitSchema = z.object({
  kind: z.literal("quote"),
  quote: QuoteRequestSchema,
  contact: ContactInfoSchema,
  recaptchaToken: z.string().min(1).optional(),
});

export const OutOfAreaSubmitSchema = z.object({
  kind: z.literal("out_of_area"),
  zip: z.string().min(5).max(10),
  contact: ContactInfoSchema.pick({ firstName: true, lastName: true, email: true }),
  recaptchaToken: z.string().min(1).optional(),
});

export const ManualQuoteRequestSubmitSchema = z.object({
  kind: z.literal("manual_quote_request"),
  address: AddressPartsSchema,
  location: LocationSchema,
  contact: ContactInfoSchema,
  message: z.string().max(2000).optional(),
  recaptchaToken: z.string().min(1).optional(),
});

export const SubmitRequestSchema = z.discriminatedUnion("kind", [
  QuoteSubmitSchema,
  OutOfAreaSubmitSchema,
  ManualQuoteRequestSubmitSchema,
]);

export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
