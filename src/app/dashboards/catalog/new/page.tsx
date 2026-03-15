import { redirect } from "next/navigation";

/**
 * Legacy URL — redirects to the new standalone Submit Product page.
 * Preserves query params (dealId, category, brand, etc.) for BOM/deal flows.
 */
export default async function CatalogNewRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams(params).toString();
  redirect(`/dashboards/submit-product${qs ? `?${qs}` : ""}`);
}
