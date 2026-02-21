export interface HomeSuiteLink {
  href: string;
  title: string;
  description: string;
  tag: string;
}

export interface HomePrototype {
  slug: string;
  title: string;
  description: string;
  direction: string;
  mood: string;
}

export const HOME_SUITES: HomeSuiteLink[] = [
  {
    href: "/suites/operations",
    title: "Operations Suite",
    description: "Core operations dashboards and scheduling workspaces.",
    tag: "Operations",
  },
  {
    href: "/suites/department",
    title: "Department Suite",
    description: "Department-level dashboards for execution teams.",
    tag: "Department",
  },
  {
    href: "/suites/executive",
    title: "Executive Suite",
    description: "Leadership dashboards and high-level planning views.",
    tag: "Executive",
  },
  {
    href: "/suites/service",
    title: "Service Suite",
    description: "Service pipeline scheduling and equipment tracking.",
    tag: "Service",
  },
  {
    href: "/suites/additional-pipeline",
    title: "Additional Pipeline",
    description: "Supplemental pipeline dashboards outside the core flow.",
    tag: "Pipelines",
  },
  {
    href: "/suites/admin",
    title: "Admin Suite",
    description: "Admin tools, security views, and testing pages.",
    tag: "Admin",
  },
];

export const HOME_METRICS = [
  { label: "Projects in flight", value: "392" },
  { label: "Revenue pipeline", value: "$14.7M" },
  { label: "Schedule conflicts", value: "12" },
  { label: "Crew utilization", value: "87%" },
];

export const HOME_PROTOTYPES: HomePrototype[] = [
  {
    slug: "command-deck",
    title: "Command Deck",
    description: "Cinematic control-room shell with KPI strip and priority modules.",
    direction: "Mission control",
    mood: "Dark / high-contrast",
  },
  {
    slug: "sunrise-briefing",
    title: "Sunrise Briefing",
    description: "Morning brief layout with timeline, notes, and quick-launch cards.",
    direction: "Daily briefing",
    mood: "Light / editorial",
  },
  {
    slug: "ledger-paper",
    title: "Ledger Paper",
    description: "Financial newspaper-inspired homepage with dense, scan-friendly blocks.",
    direction: "Business journal",
    mood: "Monochrome / serif",
  },
  {
    slug: "field-radar",
    title: "Field Radar",
    description: "Map-and-signal composition focused on field bottlenecks and dispatch state.",
    direction: "Field operations",
    mood: "Teal / steel",
  },
  {
    slug: "split-studio",
    title: "Split Studio",
    description: "Strong split-screen hierarchy with primary suite launch and side diagnostics.",
    direction: "Hero split",
    mood: "Warm / premium",
  },
  {
    slug: "metro-blocks",
    title: "Metro Blocks",
    description: "Large, colorful block system with fast target acquisition by suite type.",
    direction: "Bold grid",
    mood: "Vibrant / geometric",
  },
  {
    slug: "terminal-flow",
    title: "Terminal Flow",
    description: "Pseudo-command-line homepage with route shortcuts and status logs.",
    direction: "Ops terminal",
    mood: "Neon / technical",
  },
  {
    slug: "story-scroll",
    title: "Story Scroll",
    description: "Narrative sections that walk users from health signals to action routes.",
    direction: "Narrative flow",
    mood: "Modern / clean",
  },
  {
    slug: "signal-orbit",
    title: "Signal Orbit",
    description: "Radial navigation concept with a central system status core.",
    direction: "Non-linear nav",
    mood: "Experimental / spatial",
  },
  {
    slug: "compact-tactical",
    title: "Compact Tactical",
    description: "Dense tactical board for power users who prioritize speed over whitespace.",
    direction: "High-density console",
    mood: "Slate / efficient",
  },
];

export function getHomePrototypeBySlug(slug: string): HomePrototype | undefined {
  return HOME_PROTOTYPES.find((prototype) => prototype.slug === slug);
}
