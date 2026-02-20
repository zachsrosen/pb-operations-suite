export type PrototypeFamily = "operations" | "executive";

export interface ExtraPrototype {
  slug: string;
  title: string;
  description: string;
  replaces: string;
  family: PrototypeFamily;
  accent: string;
  tone: "night" | "dawn" | "ember" | "slate" | "ocean";
}

export const EXTRA_LAYOUT_PROTOTYPES: ExtraPrototype[] = [
  {
    slug: "operations-radar",
    title: "Operations Radar",
    description: "Conflict-first radar with lane-level urgency and queue pressure signals.",
    replaces: "/suites/operations",
    family: "operations",
    accent: "from-cyan-400/35 via-sky-400/20 to-transparent",
    tone: "ocean",
  },
  {
    slug: "operations-flightdeck",
    title: "Operations Flight Deck",
    description: "Three-column dispatch board emphasizing field readiness and hot handoffs.",
    replaces: "/suites/operations",
    family: "operations",
    accent: "from-blue-400/35 via-indigo-400/20 to-transparent",
    tone: "night",
  },
  {
    slug: "operations-queue-wall",
    title: "Operations Queue Wall",
    description: "High-density queue format with rank ordering and fast route selection.",
    replaces: "/suites/operations",
    family: "operations",
    accent: "from-teal-400/30 via-cyan-400/20 to-transparent",
    tone: "slate",
  },
  {
    slug: "operations-shift-board",
    title: "Operations Shift Board",
    description: "Shift-centric timeline with dispatch checkpoints and module shortcuts.",
    replaces: "/suites/operations",
    family: "operations",
    accent: "from-emerald-400/35 via-teal-400/20 to-transparent",
    tone: "dawn",
  },
  {
    slug: "operations-priority-map",
    title: "Operations Priority Map",
    description: "Impact vs urgency matrix to route teams toward high-value bottlenecks.",
    replaces: "/suites/operations",
    family: "operations",
    accent: "from-sky-400/35 via-cyan-400/15 to-transparent",
    tone: "night",
  },
  {
    slug: "executive-briefing",
    title: "Executive Briefing Deck",
    description: "Morning briefing structure with KPI rails and decision prompts.",
    replaces: "/suites/executive",
    family: "executive",
    accent: "from-amber-400/35 via-orange-400/20 to-transparent",
    tone: "ember",
  },
  {
    slug: "executive-ledger",
    title: "Executive Ledger",
    description: "Ledger-style command page optimized for scanning financial and capacity shifts.",
    replaces: "/suites/executive",
    family: "executive",
    accent: "from-orange-400/30 via-amber-400/20 to-transparent",
    tone: "slate",
  },
  {
    slug: "executive-compass",
    title: "Executive Compass",
    description: "Quadrant layout mapping initiatives by exposure, value, and speed.",
    replaces: "/suites/executive",
    family: "executive",
    accent: "from-rose-400/30 via-amber-300/15 to-transparent",
    tone: "night",
  },
  {
    slug: "executive-portfolio",
    title: "Executive Portfolio",
    description: "Portfolio narrative view connecting revenue, locations, and milestone timing.",
    replaces: "/suites/executive",
    family: "executive",
    accent: "from-yellow-400/35 via-amber-300/15 to-transparent",
    tone: "dawn",
  },
  {
    slug: "executive-risk-wall",
    title: "Executive Risk Wall",
    description: "Risk-segmented wall with mitigation pathing and direct dashboard actions.",
    replaces: "/suites/executive",
    family: "executive",
    accent: "from-red-400/30 via-orange-300/20 to-transparent",
    tone: "ember",
  },
];

export function getPrototypeBySlug(slug: string): ExtraPrototype | undefined {
  return EXTRA_LAYOUT_PROTOTYPES.find((prototype) => prototype.slug === slug);
}
