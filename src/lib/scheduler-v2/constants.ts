import { LOCATION_TIMEZONES } from "@/lib/constants";
import { DEFAULT_LOCATION_CAPACITY } from "@/lib/schedule-optimizer";

/**
 * Construction directors per location.
 * Copied from construction-scheduler/page.tsx.
 *
 * NOTE: Colorado Springs uses Lenny Uematsu as the director.
 * userUid is intentionally left empty — Lenny's real Zuper userUid is not
 * reliably known at build time; the schedule API resolves the assignee by
 * name at runtime. The teamUid is kept so crew-based lookups still work.
 */
export const CONSTRUCTION_DIRECTORS: Record<
  string,
  { name: string; userUid: string; teamUid: string }
> = {
  Westminster: {
    name: "Joe Lynch",
    userUid: "f203f99b-4aaf-488e-8e6a-8ee5e94ec217",
    teamUid: "1c23adb9-cefa-44c7-8506-804949afc56f",
  },
  Centennial: {
    name: "Drew Perry",
    userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353",
    teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c",
  },
  DTC: {
    name: "Drew Perry",
    userUid: "0ddc7e1d-62e1-49df-b89d-905a39c1e353",
    teamUid: "76b94bd3-e2fc-4cfe-8c2a-357b9a850b3c",
  },
  "Colorado Springs": {
    name: "Lenny Uematsu",
    // userUid intentionally empty: resolved by name at runtime
    userUid: "",
    teamUid: "1a914a0e-b633-4f12-8ed6-3348285d6b93",
  },
  "San Luis Obispo": {
    name: "Nick Scarpellino",
    userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95",
    teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
  },
  Camarillo: {
    // Camarillo shares SLO install crew
    name: "Nick Scarpellino",
    userUid: "8e67159c-48fe-4fb0-acc3-b1c905ff6e95",
    teamUid: "699cec60-f9f8-4e57-b41a-bb29b1f3649c",
  },
};

/** Canonical list of PB office locations. */
export const LOCATIONS: string[] = [
  "Westminster",
  "Centennial",
  "DTC",
  "Colorado Springs",
  "San Luis Obispo",
  "Camarillo",
];

export { LOCATION_TIMEZONES };
export { DEFAULT_LOCATION_CAPACITY };
