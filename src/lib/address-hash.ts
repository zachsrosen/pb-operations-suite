import { createHash } from "crypto";

export interface AddressParts {
  street: string;
  unit: string | null | undefined;
  city: string;
  state: string;
  zip: string;
}

export function normalizeAddressForHash(parts: AddressParts): string {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [norm(parts.street), norm(parts.unit), norm(parts.city), norm(parts.state), norm(parts.zip)].join("|");
}

export function addressHash(parts: AddressParts): string {
  return createHash("sha256").update(normalizeAddressForHash(parts)).digest("hex");
}
