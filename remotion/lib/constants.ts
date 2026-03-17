import type {
  FeatureShowcaseConfig,
  MontageStatConfig,
  MontageDashboardConfig,
} from "./types";

// ── Video Config ──────────────────────────────────────────────
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// ── Color Palette ─────────────────────────────────────────────
export const COLORS = {
  background: "#0a0a1a",
  gradientCenter: "#1a1a3e",
  gradientEdge: "#0a0a1a",
  gradientCorner: "#050510",
  gridLine: "rgba(139,92,246,0.03)",
  pbOrange: "#ea580c",
  accentPurple: "#8b5cf6",
  accentGreen: "#22c55e",
  accentCyan: "#06b6d4",
  accentAmber: "#f59e0b",
  accentBlue: "#3b82f6",
  textPrimary: "#ffffff",
  textSecondary: "#94a3b8",
  textTertiary: "#64748b",
} as const;

export const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// ── Scene Durations (in frames at 30fps) ──────────────────────
export const SCENE_FRAMES = {
  openingHook: 240,
  theProblem: 240,
  loginHomeDealsContinuous: 540,
  dealsHomeOpsSuite: 360,
  productSubmission: 420,
  bomSalesOrder: 420,
  scheduling: 540,
  sopGuide: 360,
  montage: 360,
  closing: 210,
} as const;

/** Transition duration between scenes (frames) */
export const TRANSITION_FRAMES = 15;

// ── Scene 3–8 Configs ─────────────────────────────────────────
export const FEATURE_SCENES: FeatureShowcaseConfig[] = [
  {
    id: "login-home-deals",
    accentColor: COLORS.pbOrange,
    titleCard: { label: "COMMAND CENTER", headline: "Your command center." },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/login-home-deals-ops.mp4",
    overlays: [{ text: "Real-time pipeline data", startFrame: 180, durationFrames: 90, position: "bottom-center" }],
  },
  {
    id: "deals-home-ops",
    accentColor: COLORS.pbOrange,
    videoSrc: "remotion/recordings/login-home-deals-ops.mp4",
    overlays: [{ text: "One click to any project", startFrame: 60, durationFrames: 90, position: "bottom-center" }],
  },
  {
    id: "product-submission",
    accentColor: COLORS.accentPurple,
    titleCard: { label: "PRODUCT CATALOG", headline: "One form. Every system in sync." },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/product-submission.mp4",
    overlays: [{ text: "AI-powered product creation", startFrame: 240, durationFrames: 90, position: "bottom-center" }],
  },
  {
    id: "bom-sales-order",
    accentColor: COLORS.accentGreen,
    titleCard: { label: "AUTOMATION", headline: "Planset in. Sales Order out." },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/bom-sales-order.mp4",
    overlays: [{ text: "Live on Ready To Build deals", startFrame: 240, durationFrames: 90, position: "bottom-center" }],
  },
  {
    id: "scheduling",
    accentColor: COLORS.accentCyan,
    titleCard: { label: "SCHEDULING", headline: "Drag. Drop. Scheduled." },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/scheduling.mp4",
    overlays: [
      { text: "Drag. Drop. Scheduled.", startFrame: 60, durationFrames: 60, position: "bottom-center" },
      { text: "AI-optimized scheduling", startFrame: 180, durationFrames: 60, position: "bottom-center" },
      { text: "Built-in forecasting", startFrame: 300, durationFrames: 60, position: "bottom-center" },
    ],
  },
  {
    id: "sop-guide",
    accentColor: COLORS.accentAmber,
    titleCard: { label: "DOCUMENTATION", headline: "Every process. Documented." },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/sop-guide.mp4",
    overlays: [{ text: "Searchable SOP reference", startFrame: 150, durationFrames: 90, position: "bottom-center" }],
  },
];

// ── Scene 9: Montage Config ──────────────────────────────────
export const MONTAGE_DASHBOARDS: MontageDashboardConfig[] = [
  { imageSrc: "remotion/montage/pipeline.png", label: "Pipeline Overview" },
  { imageSrc: "remotion/montage/timeline.png", label: "Timeline View" },
  { imageSrc: "remotion/montage/equipment.png", label: "Equipment Backlog" },
  { imageSrc: "remotion/montage/permitting.png", label: "Permitting & IC" },
  { imageSrc: "remotion/montage/forecast-accuracy.png", label: "Forecast Accuracy" },
  { imageSrc: "remotion/montage/forecast-timeline.png", label: "Forecast Timeline" },
  { imageSrc: "remotion/montage/revenue.png", label: "Revenue Dashboard" },
];

/** Frozen stats as of 2026-03-16 from ActivityLog table */
export const MONTAGE_STATS: MontageStatConfig[] = [
  { value: 65, suffix: "+ dashboards", color: COLORS.pbOrange },
  { value: 1376, suffix: " scheduler views", color: COLORS.accentCyan },
  { value: 24, suffix: " team members", color: COLORS.accentGreen },
];
