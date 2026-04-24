// OpenSolar equipment push — stubbed today, real client lands with the
// OpenSolar API discovery spec. Mirrors the `lib/adders/opensolar-client.ts`
// pattern: synthetic success when disabled, warn + stub when enabled but the
// real client isn't wired yet.

export type OpenSolarProductPushInput = {
  id: string;
  brand: string;
  model: string;
  category: string;
};

export type OpenSolarProductPushResult = {
  ok: boolean;
  openSolarId: string | null;
  error?: string;
};

function isEnabled(): boolean {
  return process.env.OPENSOLAR_PRODUCT_SYNC_ENABLED === "true";
}

export async function pushProductToOpenSolar(
  product: OpenSolarProductPushInput,
): Promise<OpenSolarProductPushResult> {
  if (!isEnabled()) {
    return { ok: true, openSolarId: `stub_${product.id}` };
  }
  // Real fetch() lands when OpenSolar API discovery spec completes.
  console.warn(
    "[opensolar-push] flag on but real client not yet implemented — returning synthetic success",
  );
  return { ok: true, openSolarId: `stub_${product.id}` };
}
