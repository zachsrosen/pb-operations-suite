/**
 * Goals Weekly Digest audience routing.
 *
 * Static routing map — each office digest goes to its designated recipients.
 * The "All Locations" executive digest goes to the ops leadership group.
 * Derek, Matt, and Tracey are BCC'd on all 4 per-office digests.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DigestRecipients {
  to: string[];
  bcc: string[];
}

/** Map from digest slug to recipients */
export type DigestAudienceMap = Record<string, DigestRecipients>;

// ---------------------------------------------------------------------------
// Static routing
// ---------------------------------------------------------------------------

/** BCC'd on every per-office digest */
const OFFICE_BCC = [
  "derek@photonbrothers.com",    // Derek Pomar — Sr. Director of Ops
  "matt@photonbrothers.com",     // Matt Raichart — CEO
  "tracey.mallory@photonbrothers.com", // Tracey Mallory — Sr. Director of HR
  "zach@photonbrothers.com",     // Zach — Precon Manager / Tech Ops
];

const ROUTING: DigestAudienceMap = {
  westminster: {
    to: [
      "joe@photonbrothers.com",    // Joe Lynch — Regional Director
      "nathan@photonbrothers.com", // Nathan Kirkegaard — covering for Joe
    ],
    bcc: OFFICE_BCC,
  },
  centennial: {
    to: [
      "drew@photonbrothers.com",   // Drew Perry — Field Supervisor
      "alan@photonbrothers.com",   // Alan Lanka — Electrical Supervisor
    ],
    bcc: OFFICE_BCC,
  },
  "colorado-springs": {
    to: [
      "rolando@photonbrothers.com", // Rolando Valle — Regional Director
      "lenny@photonbrothers.com",   // Lenny Uematsu — Field Supervisor
    ],
    bcc: OFFICE_BCC,
  },
  california: {
    to: [
      "kat@photonbrothers.com",    // Katlyyn Arnoldi — Regional Implementation Mgr
      "nick@photonbrothers.com",   // Nick Scarpellino — Regional Director
    ],
    bcc: OFFICE_BCC,
  },
  "all-locations": {
    to: [
      "leadership@photonbrothers.com", // Ops Leadership group
    ],
    bcc: [],
  },
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function getGoalsDigestAudienceMap(): DigestAudienceMap {
  return ROUTING;
}
