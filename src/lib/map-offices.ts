import type { LatLng } from "./map-proximity";

/**
 * Known office locations for Photon Brothers. Coordinates are approximate (street
 * addresses from public records geocoded once — hardcoded here so the feature
 * works without depending on any live geocode call.
 */
export interface OfficeLocation {
  id: string;
  label: string;
  pbLocation: string; // matches Project.pbLocation / CrewMember.locations[]
  lat: number;
  lng: number;
  address: string;
}

export const OFFICES: OfficeLocation[] = [
  {
    id: "dtc",
    label: "DTC",
    pbLocation: "DTC",
    lat: 39.5965,
    lng: -104.8847,
    address: "6300 S Syracuse Way, Centennial, CO",
  },
  {
    id: "westminster",
    label: "Westminster",
    pbLocation: "Westminster",
    lat: 39.8367,
    lng: -105.0372,
    address: "Westminster, CO",
  },
  {
    id: "cosp",
    label: "Colorado Springs",
    pbLocation: "Colorado Springs",
    lat: 38.8339,
    lng: -104.8214,
    address: "Colorado Springs, CO",
  },
  {
    id: "slo",
    label: "San Luis Obispo",
    pbLocation: "San Luis Obispo",
    lat: 35.2828,
    lng: -120.6596,
    address: "San Luis Obispo, CA",
  },
  {
    id: "camarillo",
    label: "Camarillo",
    pbLocation: "Camarillo",
    lat: 34.2164,
    lng: -119.0376,
    address: "Camarillo, CA",
  },
];

export function getOfficeByPbLocation(pbLocation: string | null | undefined): OfficeLocation | null {
  if (!pbLocation) return null;
  const target = pbLocation.toLowerCase();
  return (
    OFFICES.find((o) => o.pbLocation.toLowerCase() === target) ??
    // Fuzzy alias — Centennial lives at the DTC shop
    (target === "centennial" ? OFFICES.find((o) => o.id === "dtc") ?? null : null) ??
    null
  );
}

export function getOfficeById(id: string): OfficeLocation | null {
  return OFFICES.find((o) => o.id === id) ?? null;
}

export function officeLatLng(o: OfficeLocation): LatLng {
  return { lat: o.lat, lng: o.lng };
}
