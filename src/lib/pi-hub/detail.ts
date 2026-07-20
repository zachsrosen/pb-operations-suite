/**
 * Parameterized project detail for the unified P&I hub — one code path for
 * permit / ic / pto, driven by TEAM_CONFIGS. Ported from
 * lib/permit-hub.ts fetchPermitProjectDetail / lib/ic-hub.ts fetchIcProjectDetail.
 */

import { hubspotClient } from "@/lib/hubspot";
import { getEnumLabelMap, labelFor } from "@/lib/hubspot-enum-labels";
import {
  fetchAHJsForDeal,
  fetchAllAHJs,
  fetchUtilitiesForDeal,
  fetchAllUtilities,
  type AHJRecord,
  type UtilityRecord,
} from "@/lib/hubspot-custom-objects";
import { buildOwnerMap, locationInBucket } from "@/lib/idr-meeting";
import { buildStageDisplayMap } from "@/lib/daily-focus/format";
import { getHubSpotDealUrl } from "@/lib/external-links";
import {
  buildGmailThreadQuery,
  extractIdentifierTokens,
  fetchSharedInboxThreads,
  getSharedInboxAddress,
  type SharedInboxThread,
} from "@/lib/gmail-shared-inbox";
import { TEAM_CONFIGS, type TeamConfig } from "./config";
import { normalizeDriveFolderUrl } from "./drive";
import { resolveLeadName } from "./leads";
import type { ProjectDetail, Team } from "./types";

// Convenience re-export — the canonical definition lives in types.ts (an
// import-free-at-runtime file) so client code can import the shape without
// pulling this server module into the bundle.
export type { ProjectDetail } from "./types";

// Per-trade permit numbers — the AHJ cites these in correspondence.
const PERMIT_NUMBER_PROPERTIES = [
  "permit_number___pv",
  "permit_number___ess",
  "permit_number___elec",
  "permit_number___fire_protection",
  "permit_number___zoning___land_use",
];

/** Correspondence identifier deal properties per team. */
const IDENTIFIER_PROPERTIES: Record<Team, readonly string[]> = {
  permit: PERMIT_NUMBER_PROPERTIES,
  // Utility Application # — utility cites it in correspondence.
  ic: ["utility_application__"],
  pto: ["utility_application__"],
};

/** propertiesWithHistory set per team — status plus its milestone-date props. */
const HISTORY_PROPERTIES: Record<Team, string> = {
  permit: "permitting_status,permit_submit,permit_issued",
  ic: "interconnection_status,ic_submit,ic_approved",
  pto: "pto_status,pto_submitted,pto_granted",
};

/**
 * Engagement keyword filters per team — an engagement is team activity when
 * its subject or body matches any of these. Strings are case-insensitive
 * substrings (so "interconnect" also matches "interconnection"); regexes are
 * used where a substring over-matches — "pto" appears inside unrelated words
 * ("laptop", "acceptor"), so it only counts as a whole word.
 */
const ACTIVITY_KEYWORDS: Record<Team, readonly (string | RegExp)[]> = {
  permit: ["permit", "ahj"],
  ic: ["interconnect", "utility", "xcel"],
  pto: ["interconnect", "utility", "xcel", /\bpto\b/i],
};

export async function fetchDetail(
  team: Team,
  dealId: string,
): Promise<ProjectDetail | null> {
  const config = TEAM_CONFIGS[team];
  let deal;
  try {
    deal = await hubspotClient.crm.deals.basicApi.getById(dealId, [
      "dealname",
      "project_number",
      ...IDENTIFIER_PROPERTIES[team],
      "address_line_1",
      "city",
      "state",
      "zip",
      "pb_location",
      // Domain-panel name fallback when no formal association exists.
      ...(config.domainPanel === "ahj" ? ["ahj"] : ["utility"]),
      "amount",
      config.leadNameProperty,
      config.roleProperty,
      "project_manager",
      config.statusProperty,
      "dealstage",
      "calculated_system_size__kwdc_",
      // Google Drive folder URLs — see CLAUDE.md External system links.
      "design_documents",
      config.folderProperty,
      "g_drive",
      // Legacy / alternative property names — kept as fallbacks since
      // the HubSpot portal may use different ones on older deals.
      "planset_drive_folder_url",
      "design_folder_url",
      "all_document_folder_url",
    ]);
  } catch {
    return null;
  }

  const props = (deal.properties ?? {}) as Record<string, string | null>;
  const [ownerMap, stageMap, domain] = await Promise.all([
    buildOwnerMap([{ properties: props }]),
    buildStageDisplayMap(),
    fetchDomainRecords(config, dealId, props),
  ]);

  const status = props[config.statusProperty] ?? "";
  const statusLabel = labelFor(
    await getEnumLabelMap(config.statusProperty),
    status,
  );

  const pmId = props.project_manager;
  const resolvedPm = pmId ? (ownerMap.get(pmId) ?? pmId) : null;
  const dealStageId = props.dealstage;
  const resolvedDealStage = dealStageId
    ? (stageMap[dealStageId] ?? dealStageId)
    : null;

  const fullAddress =
    [props.address_line_1, props.city, props.state].filter(Boolean).join(", ") || null;

  const domainProps = domain.records[0]?.properties as
    | Record<string, string | null | undefined>
    | undefined;
  const domainEmail = domainProps?.email ?? null;
  const correspondenceSearchUrl =
    domainEmail && fullAddress
      ? buildGmailSearchUrl(domainEmail, fullAddress)
      : null;

  // Region routing for the shared inbox fetch. Bucket uses the same CO/CA
  // definition idr-meeting uses (Westminster/Centennial/COSP → CO;
  // SLO/Camarillo → CA). Deals in an unrecognized location get no thread
  // fetch (correspondenceInbox = null).
  let correspondenceInbox: string | null = null;
  let correspondenceThreads: SharedInboxThread[] = [];
  // Project-unique keys the AHJ/utility cites: street address, PROJ number,
  // and the per-team application/permit numbers. NOT the domain email — it is
  // shared across every project in the jurisdiction/utility and pulls in
  // other projects' threads. Hand-entered fields — extract clean tokens so
  // pollution ("06405260 (PSPS) J STEPHEN POLLOCK") can't defeat the
  // quoted-phrase match. Clean values pass through unchanged.
  const identifiers = IDENTIFIER_PROPERTIES[team].flatMap((p) =>
    extractIdentifierTokens(props[p]),
  );
  if (props.address_line_1 || props.project_number || identifiers.some(Boolean)) {
    const pbLoc = props.pb_location;
    let region: "co" | "ca" | null = null;
    if (locationInBucket(pbLoc, "colorado")) region = "co";
    else if (locationInBucket(pbLoc, "california")) region = "ca";

    if (region) {
      const mailbox = getSharedInboxAddress(config.inboxTeam, region);
      if (mailbox) {
        correspondenceInbox = mailbox;
        correspondenceThreads = await fetchSharedInboxThreads({
          mailbox,
          query: buildGmailThreadQuery({
            address: props.address_line_1,
            projectNumber: props.project_number,
            identifiers,
            lookbackDays: 90,
          }),
          maxThreads: 10,
        });
      }
    }
  }

  const designFolderUrl =
    props.design_documents ??
    props.design_folder_url ??
    props.planset_drive_folder_url ??
    null;
  const driveFolderUrl = props.g_drive ?? props.all_document_folder_url ?? null;

  const [statusHistory, activity] = await Promise.all([
    fetchStatusHistory(team, dealId),
    fetchActivity(team, dealId),
  ]);

  return {
    deal: {
      id: dealId,
      name: props.dealname ?? "Untitled",
      address: fullAddress,
      amount: props.amount ? Number(props.amount) : null,
      pbLocation: props.pb_location ?? null,
      lead: resolveLeadName(config, props, ownerMap),
      pm: resolvedPm,
      status,
      statusLabel,
      systemSizeKw: props.calculated_system_size__kwdc_
        ? Number(props.calculated_system_size__kwdc_)
        : null,
      dealStage: resolvedDealStage,
      hubspotUrl: getHubSpotDealUrl(dealId),
      designFolderUrl,
      driveFolderUrl,
      folderUrl: normalizeDriveFolderUrl(props[config.folderProperty]),
      folderLabel: config.folderLabel,
      portalUrl: (domainProps?.portal_link as string | null | undefined) ?? null,
      applicationUrl:
        (domainProps?.application_link as string | null | undefined) ?? null,
    },
    domain,
    correspondenceSearchUrl,
    correspondenceThreads,
    correspondenceInbox,
    statusHistory,
    activity,
  };
}

/**
 * Domain-panel records with fallback when no explicit HubSpot association
 * exists (common in prod):
 *   1. Match the deal's free-text name property (ahj / utility) against the
 *      custom-object record name (AHJ also matches ahj_code).
 *   2. Fall back to city + state match if the name lookup finds nothing.
 * Either way, return at most 3 matches so the team always gets portal +
 * turnaround stats, even without the formal association.
 */
async function fetchDomainRecords(
  config: TeamConfig,
  dealId: string,
  props: Record<string, string | null>,
): Promise<ProjectDetail["domain"]> {
  if (config.domainPanel === "ahj") {
    let ahj: AHJRecord[] = await fetchAHJsForDeal(dealId);
    if (ahj.length === 0) {
      try {
        const all = await fetchAllAHJs();

        const dealAhjName = (props.ahj ?? "").trim().toLowerCase();
        if (dealAhjName) {
          ahj = all
            .filter((r) => {
              const p = r.properties as Record<string, string | null>;
              const name = (p.record_name ?? "").trim().toLowerCase();
              const code = (p.ahj_code ?? "").trim().toLowerCase();
              return (
                (name && (name === dealAhjName || name.includes(dealAhjName))) ||
                (code && code === dealAhjName)
              );
            })
            .slice(0, 3);
        }

        if (ahj.length === 0 && props.city) {
          ahj = matchByCityState(all, props);
        }
      } catch {
        // fetchAllAHJs failed — leave ahj empty; UI falls back to the
        // "no AHJ record" message rather than failing the whole request.
      }
    }
    return { kind: "ahj", records: ahj };
  }

  let utility: UtilityRecord[] = await fetchUtilitiesForDeal(dealId);
  if (utility.length === 0) {
    try {
      const all = await fetchAllUtilities();
      const dealUtilityName = (props.utility ?? "").trim().toLowerCase();
      if (dealUtilityName) {
        utility = all
          .filter((r) => {
            const p = r.properties as Record<string, string | null>;
            const name =
              (p.utility_company_name ?? p.record_name ?? "").trim().toLowerCase();
            return (
              name &&
              (name === dealUtilityName || name.includes(dealUtilityName))
            );
          })
          .slice(0, 3);
      }
      if (utility.length === 0 && props.city) {
        utility = matchByCityState(all, props);
      }
    } catch {
      // leave utility empty
    }
  }
  return { kind: "utility", records: utility };
}

function matchByCityState<
  T extends { properties: Record<string, unknown> },
>(records: T[], props: Record<string, string | null>): T[] {
  const dealCity = (props.city ?? "").trim().toLowerCase();
  const dealState = (props.state ?? "").trim().toLowerCase();
  return records
    .filter((r) => {
      const p = r.properties as Record<string, string | null>;
      const city = (p.city ?? "").trim().toLowerCase();
      const state = (p.state ?? "").trim().toLowerCase();
      if (!city) return false;
      if (dealState && state && dealState !== state) return false;
      return city === dealCity;
    })
    .slice(0, 3);
}

function buildGmailSearchUrl(email: string, address: string): string {
  const query = encodeURIComponent(`from:${email} OR to:${email} "${address}"`);
  return `https://mail.google.com/mail/u/0/#search/${query}`;
}

async function fetchStatusHistory(
  team: Team,
  dealId: string,
): Promise<ProjectDetail["statusHistory"]> {
  // HubSpot property-history endpoint — shape is { propertiesWithHistory: { <prop>: [{ value, timestamp }, ...] } }
  try {
    const token = process.env.HUBSPOT_ACCESS_TOKEN;
    if (!token) return [];
    const url = new URL(`https://api.hubapi.com/crm/v3/objects/deals/${dealId}`);
    url.searchParams.set("propertiesWithHistory", HISTORY_PROPERTIES[team]);
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as {
      propertiesWithHistory?: Record<string, Array<{ value: string; timestamp: string }>>;
    };
    const history: ProjectDetail["statusHistory"] = [];
    for (const [property, entries] of Object.entries(body.propertiesWithHistory ?? {})) {
      for (const entry of entries) {
        history.push({ property, value: entry.value ?? null, timestamp: entry.timestamp });
      }
    }
    history.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
    return history;
  } catch {
    return [];
  }
}

async function fetchActivity(
  team: Team,
  dealId: string,
): Promise<ProjectDetail["activity"]> {
  try {
    const { getDealEngagements } = await import("@/lib/hubspot-engagements");
    const engagements = await getDealEngagements(dealId);
    const keywords = ACTIVITY_KEYWORDS[team];
    return engagements
      .filter((e) => {
        const subject = String(e.subject ?? "").toLowerCase();
        const body = String(e.body ?? "").toLowerCase();
        return keywords.some((k) =>
          typeof k === "string"
            ? subject.includes(k) || body.includes(k)
            : k.test(subject) || k.test(body),
        );
      })
      .slice(0, 50)
      .map((e) => ({
        id: e.id,
        type: e.type,
        subject: e.subject,
        body: e.body,
        timestamp: e.timestamp,
      }));
  } catch {
    return [];
  }
}
