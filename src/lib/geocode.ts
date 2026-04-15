export interface GeocodeInput {
  street: string;
  unit?: string | null;
  city: string;
  state: string;
  zip: string;
  country?: string;
}

export interface GeocodeResult {
  placeId: string | null; // nullable — rural/PO-box addresses sometimes return no place_id
  formattedAddress: string;
  latitude: number;
  longitude: number;
  streetNumber: string;
  route: string;
  streetAddress: string; // composed street_number + route
  city: string;
  state: string;
  zip: string;
  county: string | null;
}

export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_MAPS_API_KEY is not set");

  if (!input.street || !input.city || !input.state || !input.zip) return null;

  const fullAddress = [
    input.street + (input.unit ? ` ${input.unit}` : ""),
    input.city,
    input.state,
    input.zip,
    input.country ?? "USA",
  ]
    .filter(Boolean)
    .join(", ")
    .trim();

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", fullAddress);
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Google Geocoding HTTP ${res.status}`);
  const body = await res.json();

  if (body.status === "OVER_QUERY_LIMIT" || body.status === "UNKNOWN_ERROR") {
    throw new Error(`Google Geocoding transient: ${body.status}`);
  }
  if (body.status !== "OK" || !body.results?.length) return null;

  const r = body.results[0];
  const comp = (type: string) =>
    r.address_components.find(
      (c: { types: string[]; short_name: string }) => c.types.includes(type)
    )?.short_name ?? "";

  const streetNumber = comp("street_number");
  const route = comp("route");

  return {
    placeId: r.place_id || null,
    formattedAddress: r.formatted_address,
    latitude: r.geometry.location.lat,
    longitude: r.geometry.location.lng,
    streetNumber,
    route,
    streetAddress: [streetNumber, route].filter(Boolean).join(" "),
    city: comp("locality") || comp("sublocality"),
    state: comp("administrative_area_level_1"),
    zip: comp("postal_code"),
    county: comp("administrative_area_level_2") || null,
  };
}
