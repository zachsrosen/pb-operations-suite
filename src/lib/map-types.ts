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
  id: string; // stable: "install:PROJ-8241", "ticket:3114", "zuperjob:<uid>"
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
  dealId?: string;
  ticketId?: string;
  zuperJobUid?: string;
  rawStage?: string;
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
