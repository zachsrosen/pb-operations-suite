import { prisma } from "@/lib/db";
import { createHash } from "crypto";

export async function checkRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const now = new Date();
  const windowBoundary = new Date(now.getTime() - windowMs);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.rateLimit.findUnique({ where: { identifier: key } });
    if (!existing || existing.windowStart < windowBoundary) {
      await tx.rateLimit.upsert({
        where: { identifier: key },
        create: {
          identifier: key,
          count: 1,
          windowStart: now,
          expiresAt: new Date(now.getTime() + windowMs),
        },
        update: {
          count: 1,
          windowStart: now,
          expiresAt: new Date(now.getTime() + windowMs),
        },
      });
      return true;
    }
    if (existing.count >= limit) return false;
    await tx.rateLimit.update({
      where: { identifier: key },
      data: { count: { increment: 1 } },
    });
    return true;
  });
}

export function hashIp(ip: string | null | undefined): string {
  const salt = process.env.IP_HASH_SALT ?? "estimator-default-salt";
  const value = (ip ?? "unknown").trim();
  return createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 32);
}

export function extractIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export function rateLimitKey(action: string, ipHash: string): string {
  return `estimator:${action}:${ipHash}`;
}
