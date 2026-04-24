// src/lib/map-types.ts

export type JobMarkerKind =
  | "install"
  | "service"
  | "inspection"
  | "survey"
  | "dnr"
  | "roofing";

export type MapMode = "today" | "week" | "backlog";

export type CrewShopId = "dtc" | "westy" | "cosp" | "ca" | "camarillo";

export interface JobMarkerAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface JobMarker {
  id: string; // stable: "install:<hsid>", "ticket:<id>", "zuperjob:<uid>"
  kind: JobMarkerKind;
  scheduled: boolean;
  lat: number;
  lng: number;
  address: JobMarkerAddress;
  title: string;
  subtitle?: string;
  status?: string;
  priorityScore?: number;
  scheduledAt?: string;
  crewId?: string;
  /** Human-readable crew/tech name when we can resolve it (Zuper GET response
   *  includes user.first_name/last_name). Populated best-effort. */
  crewName?: string;
  dealId?: string;           // HubSpot internal object ID (for deep-link URLs)
  ticketId?: string;
  zuperJobUid?: string;
  rawStage?: string;
  // Job-specific enrichment (populated for project-pipeline marker kinds)
  projectNumber?: string;    // Human-readable project number shown on other schedulers
  pbLocation?: string;       // DTC / Westminster / Colorado Springs / Camarillo / SLO
  systemSizeKwDc?: number;
  batteryCount?: number;
  batterySizeKwh?: number;
  evCount?: number;
  ahj?: string;
  utility?: string;
  installCrew?: string;      // Crew name as stored on the deal
  projectManager?: string;
  dealOwner?: string;
  amount?: number;
  hubspotUrl?: string;       // Direct HubSpot deal URL
  expectedDaysForInstall?: number;
  daysForElectricians?: number;
  projectType?: string;      // Solar / Solar + Battery / D&R / Roofing
}

export interface CrewRouteStop {
  lat: number;
  lng: number;
  time: string;
  title: string;
  kind: JobMarkerKind;
}

export interface CrewPin {
  id: string;
  name: string;
  shopId: CrewShopId;
  currentLat?: number;
  currentLng?: number;
  routeStops: CrewRouteStop[];
  working: boolean;
}

export interface UnplacedMarker {
  id: string;
  kind: JobMarkerKind;
  title: string;
  address: JobMarkerAddress;
  reason: "no-cache" | "geocode-failed" | "missing-address";
}

export interface MapMarkersResponse {
  markers: JobMarker[];
  crews: CrewPin[];
  lastUpdated: string;
  droppedCount: number;
  partialFailures?: string[];
  unplaced?: UnplacedMarker[];
}
