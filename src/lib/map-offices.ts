import type { LatLng } from "./map-proximity";

/**
 * Photon Brothers office locations.
 *
 * Hardcoded — there are only 5 and they don't change often. Addresses match
 * the HubSpot Location custom object. If a shop moves, update this list.
 * Coordinates geocoded from the street addresses (approximate, accurate to
 * the block — fine for a "where's the shop" pin).
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
    label: "DTC / Centennial",
    pbLocation: "Centennial",
    lat: 39.602,
    lng: -104.8591,
    address: "9869 E Easter Ave, Centennial, CO 80112",
  },
  {
    id: "westminster",
    label: "Westminster",
    pbLocation: "Westminster",
    lat: 39.8868,
    lng: -105.0849,
    address: "7705 W 108th Ave, Broomfield, CO 80021",
  },
  {
    id: "cosp",
    label: "Colorado Springs",
    pbLocation: "Colorado Springs",
    lat: 38.8587,
    lng: -104.7362,
    address: "752 Clark Pl, Colorado Springs, CO 80915",
  },
  {
    id: "slo",
    label: "San Luis Obispo",
    pbLocation: "San Luis Obispo",
    lat: 35.2501,
    lng: -120.6782,
    address: "3566 S Higuera St, Ste 310, San Luis Obispo, CA 93401",
  },
  {
    id: "camarillo",
    label: "Camarillo",
    pbLocation: "Camarillo",
    lat: 34.2277,
    lng: -118.9795,
    address: "758 Calle Plano, Camarillo, CA 93012",
  },
];

/**
 * Lookup an office by its pbLocation (what HubSpot / CrewMember use).
 * DTC and Centennial are the same shop — fuzzy-aliased.
 */
export function getOfficeByPbLocation(pbLocation: string | null | undefined): OfficeLocation | null {
  if (!pbLocation) return null;
  const target = pbLocation.toLowerCase();
  return (
    OFFICES.find((o) => o.pbLocation.toLowerCase() === target) ??
    (target === "dtc" ? OFFICES.find((o) => o.id === "dtc") ?? null : null) ??
    null
  );
}

export function getOfficeById(id: string): OfficeLocation | null {
  return OFFICES.find((o) => o.id === id) ?? null;
}

export function officeLatLng(o: OfficeLocation): LatLng {
  return { lat: o.lat, lng: o.lng };
}
