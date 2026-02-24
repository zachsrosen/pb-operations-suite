const DEFAULT_HUBSPOT_PORTAL_ID = "21710069";
const DEFAULT_ZUPER_BASE_URL = "https://us-west-1c.zuperpro.com";

export function getHubSpotDealUrl(dealId: string): string {
  const portalId = (process.env.HUBSPOT_PORTAL_ID || DEFAULT_HUBSPOT_PORTAL_ID).trim();
  return `https://app.hubspot.com/contacts/${portalId}/record/0-3/${dealId}`;
}

export function getZuperJobUrl(jobUid?: string | null): string | null {
  const normalizedJobUid = (jobUid || "").trim();
  if (!normalizedJobUid) return null;

  const configuredBase = (
    process.env.ZUPER_WEB_URL ||
    process.env.ZUPER_API_URL ||
    DEFAULT_ZUPER_BASE_URL
  ).trim();

  const webBase = configuredBase
    .replace(/\/api\/?$/i, "")
    .replace(/\/+$/, "");

  return `${webBase}/app/job/${encodeURIComponent(normalizedJobUid)}`;
}
