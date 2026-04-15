// src/components/PropertyLink.tsx
//
// Thin clickable wrapper for rendering an address as a link that opens the
// shared <PropertyDrawer>. Takes structured `AddressParts` (matching the
// POST /api/properties/resolve contract) plus an optional display string and
// optional pre-resolved hubspotObjectId. When no id is supplied, the link
// lazily resolves on click; if resolution fails or returns null, the drawer
// still opens and shows its "no property record yet" legacy state.
"use client";

import { useState } from "react";
import type { AddressParts } from "@/lib/address-hash";
import { usePropertyDrawer } from "@/components/property/PropertyDrawerContext";

interface PropertyLinkProps {
  /** Structured address used to hash and resolve the property on the server. */
  address: AddressParts;
  /** Optional override for the user-facing text. Defaults to a formatted version of `address`. */
  display?: string;
  /** Pre-resolved HubSpot property object id. When provided, skips the resolve round-trip. */
  hubspotObjectId?: string;
  className?: string;
}

function formatAddress(address: AddressParts): string {
  const unitPart = address.unit ? `, ${address.unit}` : "";
  return `${address.street}${unitPart}, ${address.city}, ${address.state} ${address.zip}`;
}

export default function PropertyLink({
  address,
  display,
  hubspotObjectId,
  className,
}: PropertyLinkProps) {
  const { openDrawer } = usePropertyDrawer();
  const [resolving, setResolving] = useState(false);

  const label = display ?? formatAddress(address);

  const handleClick = async () => {
    if (hubspotObjectId) {
      openDrawer(hubspotObjectId);
      return;
    }
    setResolving(true);
    try {
      const r = await fetch("/api/properties/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          street: address.street,
          unit: address.unit ?? undefined,
          city: address.city,
          state: address.state,
          zip: address.zip,
        }),
      });
      if (!r.ok) {
        openDrawer(null);
        return;
      }
      const data = (await r.json()) as { propertyId: string | null };
      openDrawer(data.propertyId ?? null);
    } catch (err) {
      console.error("[PropertyLink] resolve failed:", err);
      openDrawer(null);
    } finally {
      setResolving(false);
    }
  };

  const baseClass =
    "text-cyan-400 hover:underline disabled:cursor-wait disabled:opacity-70 text-left";
  const merged = className ? `${baseClass} ${className}` : baseClass;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={resolving}
      className={merged}
    >
      {label}
      {resolving ? "…" : null}
    </button>
  );
}
