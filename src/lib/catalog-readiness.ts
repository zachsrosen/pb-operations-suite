// src/lib/catalog-readiness.ts
//
// Computes per-system downstream sync readiness for the Review step.
// Business/sync logic — separate from field config (catalog-fields.ts).

import { getCategoryFields, generateZuperSpecification } from "./catalog-fields";
import { hasVerifiedZohoMapping, getZohoGroupName } from "./zoho-taxonomy";
import { isBlank } from "./catalog-form-state";

export interface SystemReadiness {
  system: "INTERNAL" | "ZOHO" | "HUBSPOT" | "ZUPER";
  status: "ready" | "partial" | "limited";
  details: string[];
}

interface ReadinessInput {
  category: string;
  systems: Set<string>;
  specValues: Record<string, unknown>;
}

const SYSTEM_ORDER: SystemReadiness["system"][] = ["INTERNAL", "HUBSPOT", "ZOHO", "ZUPER"];

function evaluateInternal(): SystemReadiness {
  return {
    system: "INTERNAL",
    status: "ready",
    details: ["Will create/update EquipmentSku"],
  };
}

function evaluateZoho(category: string): SystemReadiness {
  if (hasVerifiedZohoMapping(category)) {
    const groupName = getZohoGroupName(category);
    return {
      system: "ZOHO",
      status: "ready",
      details: [`Zoho group: ${groupName}`],
    };
  }
  return {
    system: "ZOHO",
    status: "limited",
    details: ["No confirmed Zoho group mapping — item created without category group"],
  };
}

function evaluateHubspot(category: string, specValues: Record<string, unknown>): SystemReadiness {
  const fields = getCategoryFields(category);
  const filledMappedNames: string[] = [];
  const filledUnmappedNames: string[] = [];

  for (const field of fields) {
    if (isBlank(specValues[field.key])) continue;
    // Field is filled
    if (field.hubspotProperty) {
      filledMappedNames.push(field.hubspotProperty);
    } else {
      filledUnmappedNames.push(field.label);
    }
  }

  const totalMapped = fields.filter((f) => f.hubspotProperty).length;

  if (totalMapped === 0) {
    return {
      system: "HUBSPOT",
      status: "limited",
      details: ["No spec fields map to HubSpot properties"],
    };
  }

  if (filledUnmappedNames.length === 0) {
    return {
      system: "HUBSPOT",
      status: "ready",
      details: [
        filledMappedNames.length > 0
          ? `Will sync ${filledMappedNames.join(", ")}`
          : `${totalMapped} HubSpot-mapped field(s) available — none filled yet`,
      ],
    };
  }

  return {
    system: "HUBSPOT",
    status: "partial",
    details: [
      filledMappedNames.length > 0
        ? `Will sync ${filledMappedNames.join(", ")}`
        : "No HubSpot-mapped fields filled",
      `${filledUnmappedNames.length} filled field(s) won't sync to HubSpot (${filledUnmappedNames.join(", ")})`,
    ],
  };
}

function evaluateZuper(category: string, specValues: Record<string, unknown>): SystemReadiness {
  const specString = generateZuperSpecification(category, specValues);
  if (specString) {
    return {
      system: "ZUPER",
      status: "ready",
      details: [`Specification: "${specString}"`],
    };
  }
  return {
    system: "ZUPER",
    status: "limited",
    details: ["No specification summary will be generated"],
  };
}

/**
 * Compute downstream sync readiness for each selected system.
 * Returns results in canonical order, only for systems the user toggled on.
 */
export function getDownstreamReadiness(input: ReadinessInput): SystemReadiness[] {
  const results: SystemReadiness[] = [];

  for (const system of SYSTEM_ORDER) {
    if (!input.systems.has(system)) continue;

    switch (system) {
      case "INTERNAL":
        results.push(evaluateInternal());
        break;
      case "ZOHO":
        results.push(evaluateZoho(input.category));
        break;
      case "HUBSPOT":
        results.push(evaluateHubspot(input.category, input.specValues));
        break;
      case "ZUPER":
        results.push(evaluateZuper(input.category, input.specValues));
        break;
    }
  }

  return results;
}
