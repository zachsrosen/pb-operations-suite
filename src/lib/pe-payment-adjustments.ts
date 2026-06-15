// ---------------------------------------------------------------------------
// PE payment adjustments (short-pays)
//
// The "collected" total sums each deal's EXPECTED IC/PC amounts for milestones
// marked Paid — we don't track actual dollars received, so a short-pay (PE paid
// less than the milestone amount) overstates collected. These admin-set records
// capture the per-milestone shortfall so collected reflects reality.
//
// Stored as a single JSON row in SystemConfig — no migration, low volume.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";

const CONFIG_KEY = "pe_payment_adjustments";

export interface PaymentAdjustment {
  m1Short: number; // dollars under-paid on M1 (IC)
  m2Short: number; // dollars under-paid on M2 (PC)
  note: string;
  setBy: string;
  at: string; // ISO
}

export type PaymentAdjustmentMap = Record<string, PaymentAdjustment>; // key: dealId

export async function getPaymentAdjustments(): Promise<PaymentAdjustmentMap> {
  if (!prisma) return {};
  const row = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    return parsed && typeof parsed === "object" ? (parsed as PaymentAdjustmentMap) : {};
  } catch {
    return {};
  }
}

/** Set (any shortfall > 0) or clear (both 0) a deal's short-pay record. */
export async function setPaymentAdjustment(args: {
  dealId: string;
  m1Short: number;
  m2Short: number;
  note: string;
  setBy: string;
}): Promise<void> {
  if (!prisma) throw new Error("Database not available");
  const raw = await getPaymentAdjustments();
  const m1 = Math.max(0, Number(args.m1Short) || 0);
  const m2 = Math.max(0, Number(args.m2Short) || 0);
  if (m1 === 0 && m2 === 0) {
    delete raw[args.dealId];
  } else {
    raw[args.dealId] = { m1Short: m1, m2Short: m2, note: args.note ?? "", setBy: args.setBy, at: new Date().toISOString() };
  }
  await prisma.systemConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(raw) },
    update: { value: JSON.stringify(raw) },
  });
}
