# PB Tech Ops Suite Walkthrough Video — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ~120-second cinematic Remotion video composition introducing the PB Tech Ops Suite to Photon Brothers leadership.

**Architecture:** 10-scene TransitionSeries composition with 6 shared components, 5 scene modules, and a top-level orchestrator. Screen recordings are embedded as `<Video>` elements from local files. A placeholder system allows full preview during development without recordings. The spec's proposed `SceneTransition.tsx` component is replaced by `@remotion/transitions` (`TransitionSeries` + `fade()`), which uses official Remotion APIs and is a cleaner approach.

**Note on duration:** The spec targets ~123s (3690 frames). With `<TransitionSeries>`, 9 transitions of 15 frames each overlap adjacent scenes, yielding ~118.5s (~3555 frames). This is within the "under 2 minutes 15 seconds" success criterion.

**Tech Stack:** Remotion 4.x, @remotion/cli, @remotion/media, @remotion/transitions, @remotion/tailwind-v4, TypeScript, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-16-walkthrough-video-design.md`

---

## File Structure

```
remotion.config.ts                          # CREATE — Remotion CLI config (project root)
.gitignore                                  # MODIFY — add public/remotion/ asset dirs
package.json                                # MODIFY — add remotion scripts + sideEffects

remotion/
├── index.css                               # CREATE — Tailwind v4 entry
├── Root.tsx                                 # CREATE — Composition registration
├── WalkthroughVideo.tsx                     # CREATE — Main orchestrator (TransitionSeries)
├── lib/
│   ├── constants.ts                        # CREATE — Colors, timing, scene configs
│   └── types.ts                            # CREATE — Shared TypeScript types
├── components/
│   ├── GlowBackground.tsx                  # CREATE — Dark radial gradient + grid overlay
│   ├── TextReveal.tsx                      # CREATE — Spring-animated text (fade + slide up)
│   ├── TitleCard.tsx                       # CREATE — Feature title card with accent bar
│   ├── ScreenFrame.tsx                     # CREATE — Cinematic frame wrapper for recordings
│   ├── OverlayLabel.tsx                    # CREATE — Floating text labels during recordings
│   ├── StatCounter.tsx                     # CREATE — Animated number counter
│   └── RecordingPlaceholder.tsx            # CREATE — Dev placeholder for missing recordings
├── scenes/
│   ├── OpeningHook.tsx                     # CREATE — Scene 1: Logo reveal
│   ├── TheProblem.tsx                      # CREATE — Scene 2: Three systems converge
│   ├── FeatureShowcase.tsx                 # CREATE — Scenes 3-8: Parameterized feature scene
│   ├── Montage.tsx                         # CREATE — Scene 9: Dashboard flashes + stats
│   └── Closing.tsx                         # CREATE — Scene 10: Logo + CTA
└── assets/                                 # (informational — lives in public/remotion/)

public/remotion/
├── recordings/                             # Screen recording MP4s (gitignored, local only)
│   └── .gitkeep
├── montage/                                # Dashboard screenshots (gitignored, local only)
│   └── .gitkeep
└── music/                                  # Background music track (gitignored, local only)
    └── .gitkeep
```

---

## Chunk 1: Setup & Foundation

### Task 1: Install Remotion Packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Remotion core packages**

Run:
```bash
cd "/Users/zach/Downloads/Dev Projects/PB-Operations-Suite"
npm install remotion @remotion/cli @remotion/media @remotion/transitions @remotion/tailwind-v4
```

Expected: packages install successfully, added to `dependencies` in package.json.

- [ ] **Step 2: Add Remotion scripts and sideEffects to package.json**

Add these scripts to the `"scripts"` block:
```json
"remotion:studio": "remotion studio remotion/Root.tsx",
"remotion:render": "remotion render remotion/Root.tsx WalkthroughVideo out/walkthrough-video.mp4"
```

Add at the top level of package.json:
```json
"sideEffects": ["*.css"]
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install Remotion packages for walkthrough video"
```

---

### Task 2: Create Remotion Config & Directory Structure

**Files:**
- Create: `remotion.config.ts`
- Create: `remotion/index.css`
- Create: `public/remotion/recordings/.gitkeep`
- Create: `public/remotion/montage/.gitkeep`
- Create: `public/remotion/music/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Create remotion.config.ts at project root**

```ts
// remotion.config.ts
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

Config.overrideWebpackConfig((currentConfiguration) => {
  return enableTailwind(currentConfiguration);
});
```

- [ ] **Step 2: Create remotion/index.css**

```css
@import "tailwindcss";
```

- [ ] **Step 3: Create asset directories with .gitkeep files**

```bash
mkdir -p "public/remotion/recordings" "public/remotion/montage" "public/remotion/music"
touch "public/remotion/recordings/.gitkeep" "public/remotion/montage/.gitkeep" "public/remotion/music/.gitkeep"
```

- [ ] **Step 4: Add gitignore entries for large media files**

Append to `.gitignore`:
```
# Remotion video assets (large files, local only)
public/remotion/recordings/*.mp4
public/remotion/montage/*.png
public/remotion/montage/*.jpg
public/remotion/music/*.mp3
public/remotion/music/*.wav
```

- [ ] **Step 5: Commit**

```bash
git add remotion.config.ts remotion/index.css public/remotion/ .gitignore
git commit -m "chore: add Remotion config, asset dirs, and gitignore entries"
```

---

### Task 3: Create Constants & Types

**Files:**
- Create: `remotion/lib/constants.ts`
- Create: `remotion/lib/types.ts`

- [ ] **Step 1: Create remotion/lib/types.ts**

```ts
// remotion/lib/types.ts

/** Props for the TitleCard component */
export type TitleCardConfig = {
  label: string;
  headline: string;
  subtitle?: string;
};

/** A text overlay that appears during a screen recording */
export type OverlayConfig = {
  text: string;
  /** Frame offset relative to the start of the recording (not the scene) */
  startFrame: number;
  /** How many frames the overlay is visible */
  durationFrames: number;
  /** Position on screen */
  position?: "bottom-center" | "bottom-left" | "bottom-right" | "top-center";
};

/** Props for a single FeatureShowcase scene */
export type FeatureShowcaseConfig = {
  /** Unique key for this scene */
  id: string;
  /** Accent color hex for title card bar and overlay labels */
  accentColor: string;
  /** Title card shown before the recording. Omit for no title card. */
  titleCard?: TitleCardConfig;
  /** Duration of the title card in frames (default 60 = 2s) */
  titleCardFrames?: number;
  /** Path to the main screen recording MP4 relative to public/ */
  videoSrc: string;
  /** Text overlays that appear during the recording */
  overlays?: OverlayConfig[];
  /** Trim the beginning of the video (frames). Use for Scene 4 to skip past Scene 3's portion. */
  videoTrimBefore?: number;
  /** Trim the end of the video (frames). Use for Scene 3 to cut before Scene 4's portion. */
  videoTrimAfter?: number;
  /** Playback speed multiplier (default 1). Adjust if recording is longer/shorter than target. */
  videoPlaybackRate?: number;
};

/** A single stat displayed in the montage */
export type MontageStatConfig = {
  value: number;
  prefix?: string;
  suffix: string;
  color: string;
};

/** A dashboard screenshot for the montage rapid-fire section */
export type MontageDashboardConfig = {
  /** Path to screenshot image relative to public/ */
  imageSrc: string;
  /** Label shown briefly */
  label: string;
};
```

- [ ] **Step 2: Create remotion/lib/constants.ts**

```ts
// remotion/lib/constants.ts
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
  openingHook: 240, // 8s
  theProblem: 240, // 8s
  loginHomeDealsContinuous: 540, // 18s (Scene 3)
  dealsHomeOpsSuite: 360, // 12s (Scene 4)
  productSubmission: 420, // 14s (Scene 5)
  bomSalesOrder: 420, // 14s (Scene 6)
  scheduling: 540, // 18s (Scene 7)
  sopGuide: 360, // 12s (Scene 8)
  montage: 360, // 12s (Scene 9)
  closing: 210, // 7s (Scene 10)
} as const;

/** Transition duration between scenes (frames) */
export const TRANSITION_FRAMES = 15;

// ── Scene 3–8 Configs ─────────────────────────────────────────
export const FEATURE_SCENES: FeatureShowcaseConfig[] = [
  // Scene 3: Login → Home → Deals
  {
    id: "login-home-deals",
    accentColor: COLORS.pbOrange,
    titleCard: {
      label: "COMMAND CENTER",
      headline: "Your command center.",
    },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/login-home-deals-ops.mp4",
    overlays: [
      {
        text: "Real-time pipeline data",
        startFrame: 180,
        durationFrames: 90,
        position: "bottom-center",
      },
    ],
  },
  // Scene 4: Deals → Home → Ops Suite
  {
    id: "deals-home-ops",
    accentColor: COLORS.pbOrange,
    // No title card — continues naturally from Scene 3
    videoSrc: "remotion/recordings/login-home-deals-ops.mp4",
    overlays: [
      {
        text: "One click to any project",
        startFrame: 60,
        durationFrames: 90,
        position: "bottom-center",
      },
    ],
  },
  // Scene 5: Product Submission + AI
  {
    id: "product-submission",
    accentColor: COLORS.accentPurple,
    titleCard: {
      label: "PRODUCT CATALOG",
      headline: "One form. Every system in sync.",
    },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/product-submission.mp4",
    overlays: [
      {
        text: "AI-powered product creation",
        startFrame: 240,
        durationFrames: 90,
        position: "bottom-center",
      },
    ],
  },
  // Scene 6: BOM & Sales Order
  {
    id: "bom-sales-order",
    accentColor: COLORS.accentGreen,
    titleCard: {
      label: "AUTOMATION",
      headline: "Planset in. Sales Order out.",
    },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/bom-sales-order.mp4",
    overlays: [
      {
        text: "Live on Ready To Build deals",
        startFrame: 240,
        durationFrames: 90,
        position: "bottom-center",
      },
    ],
  },
  // Scene 7: Scheduling (Power Scene)
  {
    id: "scheduling",
    accentColor: COLORS.accentCyan,
    titleCard: {
      label: "SCHEDULING",
      headline: "Drag. Drop. Scheduled.",
    },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/scheduling.mp4",
    overlays: [
      {
        text: "Drag. Drop. Scheduled.",
        startFrame: 60,
        durationFrames: 60,
        position: "bottom-center",
      },
      {
        text: "AI-optimized scheduling",
        startFrame: 180,
        durationFrames: 60,
        position: "bottom-center",
      },
      {
        text: "Built-in forecasting",
        startFrame: 300,
        durationFrames: 60,
        position: "bottom-center",
      },
    ],
  },
  // Scene 8: SOP Guide
  {
    id: "sop-guide",
    accentColor: COLORS.accentAmber,
    titleCard: {
      label: "DOCUMENTATION",
      headline: "Every process. Documented.",
    },
    titleCardFrames: 60,
    videoSrc: "remotion/recordings/sop-guide.mp4",
    overlays: [
      {
        text: "Searchable SOP reference",
        startFrame: 150,
        durationFrames: 90,
        position: "bottom-center",
      },
    ],
  },
];

// ── Scene 9: Montage Config ──────────────────────────────────
export const MONTAGE_DASHBOARDS: MontageDashboardConfig[] = [
  { imageSrc: "remotion/montage/pipeline.png", label: "Pipeline Overview" },
  { imageSrc: "remotion/montage/timeline.png", label: "Timeline View" },
  {
    imageSrc: "remotion/montage/equipment.png",
    label: "Equipment Backlog",
  },
  {
    imageSrc: "remotion/montage/permitting.png",
    label: "Permitting & IC",
  },
  {
    imageSrc: "remotion/montage/forecast-accuracy.png",
    label: "Forecast Accuracy",
  },
  {
    imageSrc: "remotion/montage/forecast-timeline.png",
    label: "Forecast Timeline",
  },
  { imageSrc: "remotion/montage/revenue.png", label: "Revenue Dashboard" },
];

/** Frozen stats as of 2026-03-16 from ActivityLog table */
export const MONTAGE_STATS: MontageStatConfig[] = [
  {
    value: 65,
    suffix: "+ dashboards",
    color: COLORS.pbOrange,
  },
  {
    value: 1376,
    suffix: " scheduler views",
    color: COLORS.accentCyan,
  },
  {
    value: 24,
    suffix: " team members",
    color: COLORS.accentGreen,
  },
];
```

- [ ] **Step 3: Commit**

```bash
git add remotion/lib/
git commit -m "feat(remotion): add constants and types for walkthrough video"
```

---

### Task 4: Create Root.tsx & Empty Orchestrator

**Files:**
- Create: `remotion/Root.tsx`
- Create: `remotion/WalkthroughVideo.tsx` (placeholder)

- [ ] **Step 1: Create placeholder WalkthroughVideo.tsx**

```tsx
// remotion/WalkthroughVideo.tsx
import { AbsoluteFill } from "remotion";
import { COLORS, FONT_FAMILY } from "./lib/constants";

export const WalkthroughVideo: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.background,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          color: COLORS.textPrimary,
          fontSize: 48,
          fontWeight: 800,
          fontFamily: FONT_FAMILY,
        }}
      >
        PB Tech Ops Suite — Walkthrough Video
      </div>
      <div
        style={{
          color: COLORS.textSecondary,
          fontSize: 18,
          fontFamily: FONT_FAMILY,
          marginTop: 16,
        }}
      >
        Placeholder — scenes will be added in subsequent tasks
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Create Root.tsx**

```tsx
// remotion/Root.tsx
import "./index.css";
import { Composition } from "remotion";
import { WalkthroughVideo } from "./WalkthroughVideo";
import { FPS, WIDTH, HEIGHT, SCENE_FRAMES, TRANSITION_FRAMES } from "./lib/constants";

// Total frames = sum of all scene frames minus overlapping transitions
// 10 scenes = 9 transitions between them
const sceneDurations = Object.values(SCENE_FRAMES);
const totalFrames =
  sceneDurations.reduce((sum, d) => sum + d, 0) -
  (sceneDurations.length - 1) * TRANSITION_FRAMES;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="WalkthroughVideo"
      component={WalkthroughVideo}
      durationInFrames={totalFrames}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
```

- [ ] **Step 3: Verify Remotion Studio launches**

Run:
```bash
npx remotion studio remotion/Root.tsx
```

Expected: Browser opens with Remotion Studio showing "WalkthroughVideo" in the sidebar. The placeholder text is visible in the preview.

- [ ] **Step 4: Commit**

```bash
git add remotion/Root.tsx remotion/WalkthroughVideo.tsx
git commit -m "feat(remotion): add Root composition and placeholder orchestrator"
```

---

## Chunk 2: Shared Components

### Task 5: GlowBackground Component

**Files:**
- Create: `remotion/components/GlowBackground.tsx`

- [ ] **Step 1: Create GlowBackground.tsx**

```tsx
// remotion/components/GlowBackground.tsx
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../lib/constants";

type GlowBackgroundProps = {
  showOrangeGlow?: boolean;
  glowIntensity?: number;
};

export const GlowBackground: React.FC<GlowBackgroundProps> = ({
  showOrangeGlow = false,
  glowIntensity = 0.03,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const glowPulse = showOrangeGlow
    ? interpolate(
        Math.sin((frame / fps) * Math.PI * 0.5),
        [-1, 1],
        [glowIntensity * 0.5, glowIntensity * 1.5]
      )
    : 0;

  return (
    <AbsoluteFill>
      {/* Base radial gradient */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(ellipse at center, ${COLORS.gradientCenter} 0%, ${COLORS.gradientEdge} 60%, ${COLORS.gradientCorner} 100%)`,
        }}
      />
      {/* Grid overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${COLORS.gridLine} 1px, transparent 1px),
            linear-gradient(90deg, ${COLORS.gridLine} 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      {/* Orange glow spot at top center */}
      {showOrangeGlow && (
        <div
          style={{
            position: "absolute",
            top: "-10%",
            left: "50%",
            transform: "translateX(-50%)",
            width: "60%",
            height: "40%",
            background: `radial-gradient(ellipse, rgba(249,115,22,${glowPulse}) 0%, transparent 70%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify in Studio**

Temporarily render `<GlowBackground showOrangeGlow />` inside WalkthroughVideo.tsx to confirm the gradient, grid, and glow render correctly. Then revert.

- [ ] **Step 3: Commit**

```bash
git add remotion/components/GlowBackground.tsx
git commit -m "feat(remotion): add GlowBackground component"
```

---

### Task 6: TextReveal Component

**Files:**
- Create: `remotion/components/TextReveal.tsx`

- [ ] **Step 1: Create TextReveal.tsx**

```tsx
// remotion/components/TextReveal.tsx
import { spring, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { COLORS, FONT_FAMILY } from "../lib/constants";

type TextRevealProps = {
  text: string;
  delay?: number;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  secondaryColor?: string;
  letterSpacing?: number;
  textTransform?: "uppercase" | "none";
  textAlign?: React.CSSProperties["textAlign"];
  maxWidth?: number;
  lineHeight?: number;
  /** Glow shadow behind text using the given color */
  glowColor?: string;
};

export const TextReveal: React.FC<TextRevealProps> = ({
  text,
  delay = 0,
  fontSize = 36,
  fontWeight = 800,
  color = COLORS.textPrimary,
  letterSpacing = -0.5,
  textTransform = "none",
  textAlign = "center",
  maxWidth,
  lineHeight = 1.2,
  glowColor,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
  });

  const opacity = interpolate(progress, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(progress, [0, 1], [30, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        fontSize,
        fontWeight,
        color,
        letterSpacing,
        textTransform,
        textAlign,
        fontFamily: FONT_FAMILY,
        lineHeight,
        maxWidth,
        textShadow: glowColor
          ? `0 0 40px ${glowColor}, 0 0 80px ${glowColor}`
          : undefined,
      }}
    >
      {text}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/components/TextReveal.tsx
git commit -m "feat(remotion): add TextReveal component"
```

---

### Task 7: TitleCard Component

**Files:**
- Create: `remotion/components/TitleCard.tsx`

- [ ] **Step 1: Create TitleCard.tsx**

```tsx
// remotion/components/TitleCard.tsx
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../lib/constants";
import type { TitleCardConfig } from "../lib/types";

type TitleCardProps = TitleCardConfig & {
  accentColor: string;
  delay?: number;
};

export const TitleCard: React.FC<TitleCardProps> = ({
  label,
  headline,
  subtitle,
  accentColor,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
  });

  const opacity = interpolate(entrance, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  const translateX = interpolate(entrance, [0, 1], [-40, 0], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateX(${translateX}px)`,
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 20,
        }}
      >
        {/* Accent bar */}
        <div
          style={{
            width: 4,
            height: subtitle ? 80 : 60,
            backgroundColor: accentColor,
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Category label */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: accentColor,
              fontFamily: FONT_FAMILY,
            }}
          >
            {label}
          </div>
          {/* Headline */}
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.textPrimary,
              letterSpacing: -0.5,
              fontFamily: FONT_FAMILY,
            }}
          >
            {headline}
          </div>
          {/* Subtitle */}
          {subtitle && (
            <div
              style={{
                fontSize: 14,
                fontWeight: 400,
                color: COLORS.textTertiary,
                fontFamily: FONT_FAMILY,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/components/TitleCard.tsx
git commit -m "feat(remotion): add TitleCard component"
```

---

### Task 8: ScreenFrame Component

**Files:**
- Create: `remotion/components/ScreenFrame.tsx`

- [ ] **Step 1: Create ScreenFrame.tsx**

```tsx
// remotion/components/ScreenFrame.tsx
import React, { useState, useEffect, useCallback } from "react";
import {
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  spring,
  AbsoluteFill,
  delayRender,
  continueRender,
} from "remotion";
import { Video } from "@remotion/media";
import { staticFile } from "remotion";
import { WIDTH, HEIGHT } from "../lib/constants";
import { RecordingPlaceholder } from "./RecordingPlaceholder";

type ScreenFrameProps = {
  /** Path to video file relative to public/ */
  videoSrc: string;
  /** Initial scale of the recording frame (default 0.88) */
  initialScale?: number;
  /** Optional zoom target scale */
  zoomTo?: number;
  /** Frame at which zoom begins */
  zoomStartFrame?: number;
  /** Duration of zoom animation in frames */
  zoomDurationFrames?: number;
  /** Trim the beginning of the video (frames) */
  trimBefore?: number;
  /** Trim the end of the video (frames) */
  trimAfter?: number;
  /** Playback speed multiplier */
  playbackRate?: number;
};

/**
 * Uses delayRender/continueRender to probe whether the recording file
 * exists at the staticFile URL. If the fetch 404s, we fall back to
 * RecordingPlaceholder so Studio can preview the full composition
 * before any screen recordings are captured.
 */
const useRecordingExists = (videoSrc: string) => {
  const [exists, setExists] = useState<boolean | null>(null);
  const [handle] = useState(() => delayRender("Checking if recording exists"));

  const resolve = useCallback(
    (value: boolean) => {
      setExists(value);
      continueRender(handle);
    },
    [handle]
  );

  useEffect(() => {
    if (!videoSrc) {
      resolve(false);
      return;
    }
    const url = staticFile(videoSrc);
    fetch(url, { method: "HEAD" })
      .then((res) => resolve(res.ok))
      .catch(() => resolve(false));
  }, [videoSrc, resolve]);

  return exists;
};

export const ScreenFrame: React.FC<ScreenFrameProps> = ({
  videoSrc,
  initialScale = 0.88,
  zoomTo,
  zoomStartFrame = 0,
  zoomDurationFrames = 30,
  trimBefore,
  trimAfter,
  playbackRate = 1,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const recordingExists = useRecordingExists(videoSrc);

  // Entrance scale animation (recording slides in from slightly larger)
  const entranceProgress = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 20,
  });
  const entranceScale = interpolate(
    entranceProgress,
    [0, 1],
    [initialScale * 0.95, initialScale],
    { extrapolateRight: "clamp" }
  );

  // Optional zoom
  let scale = entranceScale;
  if (zoomTo !== undefined && frame >= zoomStartFrame) {
    const zoomProgress = spring({
      frame: frame - zoomStartFrame,
      fps,
      config: { damping: 200 },
      durationInFrames: zoomDurationFrames,
    });
    scale = interpolate(zoomProgress, [0, 1], [initialScale, zoomTo], {
      extrapolateRight: "clamp",
    });
  }

  const entranceOpacity = interpolate(entranceProgress, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Show placeholder while checking, or if file doesn't exist
  const showPlaceholder = recordingExists !== true;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: entranceOpacity,
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          borderRadius: 12,
          overflow: "hidden",
          boxShadow:
            "0 25px 50px rgba(0,0,0,0.5), 0 0 100px rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.08)",
          width: WIDTH,
          height: HEIGHT,
        }}
      >
        {showPlaceholder ? (
          <RecordingPlaceholder label={videoSrc} />
        ) : (
          <Video
            src={staticFile(videoSrc)}
            style={{ width: WIDTH, height: HEIGHT }}
            muted
            playbackRate={playbackRate}
            trimBefore={trimBefore}
            trimAfter={trimAfter}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/components/ScreenFrame.tsx
git commit -m "feat(remotion): add ScreenFrame component"
```

---

### Task 9: RecordingPlaceholder Component

**Files:**
- Create: `remotion/components/RecordingPlaceholder.tsx`

- [ ] **Step 1: Create RecordingPlaceholder.tsx**

This component renders when a screen recording MP4 is not yet available, showing a dark card with the expected filename so the composition can be fully previewed during development.

```tsx
// remotion/components/RecordingPlaceholder.tsx
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { COLORS, FONT_FAMILY, WIDTH, HEIGHT } from "../lib/constants";

type RecordingPlaceholderProps = {
  label: string;
};

export const RecordingPlaceholder: React.FC<RecordingPlaceholderProps> = ({
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Subtle scanning line animation
  const scanY = interpolate(
    frame % (fps * 3),
    [0, fps * 3],
    [0, HEIGHT],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#111118",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Scan line */}
      <div
        style={{
          position: "absolute",
          top: scanY,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent 0%, ${COLORS.accentPurple}40 50%, transparent 100%)`,
        }}
      />
      {/* Center content */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            border: `2px solid ${COLORS.textTertiary}`,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontSize: 36,
            color: COLORS.textTertiary,
            fontFamily: FONT_FAMILY,
          }}
        >
          ▶
        </div>
        <div
          style={{
            fontSize: 14,
            color: COLORS.textTertiary,
            fontFamily: FONT_FAMILY,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Recording Placeholder
        </div>
        <div
          style={{
            fontSize: 12,
            color: COLORS.textTertiary,
            fontFamily: "monospace",
            opacity: 0.6,
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/components/RecordingPlaceholder.tsx
git commit -m "feat(remotion): add RecordingPlaceholder for dev preview"
```

---

### Task 10: OverlayLabel Component

**Files:**
- Create: `remotion/components/OverlayLabel.tsx`

- [ ] **Step 1: Create OverlayLabel.tsx**

```tsx
// remotion/components/OverlayLabel.tsx
import {
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../lib/constants";

type OverlayLabelProps = {
  text: string;
  accentColor?: string;
  position?: "bottom-center" | "bottom-left" | "bottom-right" | "top-center";
};

const POSITION_STYLES: Record<
  NonNullable<OverlayLabelProps["position"]>,
  React.CSSProperties
> = {
  "bottom-center": {
    bottom: 80,
    left: "50%",
    transform: "translateX(-50%)",
  },
  "bottom-left": {
    bottom: 80,
    left: 80,
  },
  "bottom-right": {
    bottom: 80,
    right: 80,
  },
  "top-center": {
    top: 80,
    left: "50%",
    transform: "translateX(-50%)",
  },
};

export const OverlayLabel: React.FC<OverlayLabelProps> = ({
  text,
  accentColor = COLORS.pbOrange,
  position = "bottom-center",
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Entrance spring
  const entrance = spring({
    frame,
    fps,
    config: { damping: 200 },
  });

  // Exit spring (starts 0.5s before end)
  const exitDelay = Math.max(0, durationInFrames - Math.round(fps * 0.5));
  const exit = spring({
    frame,
    fps,
    delay: exitDelay,
    config: { damping: 200 },
  });

  const opacity = interpolate(entrance - exit, [0, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const translateY = interpolate(entrance, [0, 1], [20, 0], {
    extrapolateRight: "clamp",
  });

  const posStyles = POSITION_STYLES[position];

  return (
    // Outer div handles positioning (left/right/top/bottom + centering transform)
    <div
      style={{
        position: "absolute",
        ...posStyles,
      }}
    >
      {/* Inner div handles animation transforms separately */}
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 20px",
          borderRadius: 8,
          backgroundColor: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${accentColor}40`,
        }}
      >
      {/* Accent dot */}
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: accentColor,
          boxShadow: `0 0 10px ${accentColor}`,
        }}
      />
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: COLORS.textPrimary,
          fontFamily: FONT_FAMILY,
          letterSpacing: 0.3,
        }}
      >
        {text}
      </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/components/OverlayLabel.tsx
git commit -m "feat(remotion): add OverlayLabel component"
```

---

### Task 11: StatCounter Component

**Files:**
- Create: `remotion/components/StatCounter.tsx`

- [ ] **Step 1: Create StatCounter.tsx**

```tsx
// remotion/components/StatCounter.tsx
import {
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { COLORS, FONT_FAMILY } from "../lib/constants";

type StatCounterProps = {
  value: number;
  prefix?: string;
  suffix: string;
  color: string;
  delay?: number;
};

export const StatCounter: React.FC<StatCounterProps> = ({
  value,
  prefix = "",
  suffix,
  color,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    delay,
    config: { damping: 200 },
    durationInFrames: Math.round(fps * 1.2),
  });

  const displayValue = Math.round(interpolate(progress, [0, 1], [0, value]));

  const opacity = interpolate(progress, [0, 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  const scale = interpolate(progress, [0, 1], [0.8, 1], {
    extrapolateRight: "clamp",
  });

  const formattedValue = displayValue.toLocaleString();

  return (
    <div
      style={{
        opacity,
        transform: `scale(${scale})`,
        display: "flex",
        alignItems: "baseline",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 48,
          fontWeight: 800,
          color: COLORS.textPrimary,
          fontFamily: FONT_FAMILY,
          textShadow: `0 0 40px ${color}60`,
        }}
      >
        {prefix}
        {formattedValue}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color,
          fontFamily: FONT_FAMILY,
        }}
      >
        {suffix}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/components/StatCounter.tsx
git commit -m "feat(remotion): add StatCounter component"
```

---

### Task 12: Verify all components render in Studio

- [ ] **Step 1: Create a temporary test composition**

Temporarily update `WalkthroughVideo.tsx` to render each component in sequence to verify they all render without errors:

```tsx
// remotion/WalkthroughVideo.tsx (temporary verification)
import { AbsoluteFill, Sequence } from "remotion";
import { GlowBackground } from "./components/GlowBackground";
import { TextReveal } from "./components/TextReveal";
import { TitleCard } from "./components/TitleCard";
import { ScreenFrame } from "./components/ScreenFrame";
import { OverlayLabel } from "./components/OverlayLabel";
import { StatCounter } from "./components/StatCounter";
import { COLORS } from "./lib/constants";

export const WalkthroughVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <GlowBackground showOrangeGlow />

      <Sequence durationInFrames={90} premountFor={30}>
        <TextReveal text="TextReveal Component" fontSize={42} />
      </Sequence>

      <Sequence from={90} durationInFrames={90} premountFor={30}>
        <TitleCard
          label="TESTING"
          headline="TitleCard Component"
          subtitle="Subtitle text here"
          accentColor={COLORS.pbOrange}
        />
      </Sequence>

      <Sequence from={180} durationInFrames={90} premountFor={30}>
        <ScreenFrame videoSrc="" />
      </Sequence>

      <Sequence from={270} durationInFrames={90} premountFor={30}>
        <AbsoluteFill>
          <OverlayLabel text="OverlayLabel Component" accentColor={COLORS.accentCyan} />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={360} durationInFrames={90} premountFor={30}>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <StatCounter value={1376} suffix=" views" color={COLORS.accentCyan} />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Run Remotion Studio and scrub through the timeline**

Run:
```bash
npx remotion studio remotion/Root.tsx
```

Expected: Each component renders in sequence without errors. GlowBackground shows behind everything with gradient + grid. TextReveal fades in with spring. TitleCard slides in from left. ScreenFrame shows the RecordingPlaceholder. OverlayLabel appears with backdrop blur. StatCounter counts up from 0 to 1376.

- [ ] **Step 3: Commit the verified state (keep temporary test)**

```bash
git add remotion/WalkthroughVideo.tsx
git commit -m "test(remotion): verify all shared components render correctly"
```

---

## Chunk 3: Scene Implementations

### Task 13: OpeningHook Scene (Scene 1)

**Files:**
- Create: `remotion/scenes/OpeningHook.tsx`

- [ ] **Step 1: Create OpeningHook.tsx**

Scene 1 (8s = 240 frames): Dark screen → PB orange glow pulses → Photon Brothers logo scales in with spring → "Introducing the PB Tech Ops Suite" reveals below.

```tsx
// remotion/scenes/OpeningHook.tsx
import {
  AbsoluteFill,
  Img,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  staticFile,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { TextReveal } from "../components/TextReveal";
import { COLORS, FONT_FAMILY } from "../lib/constants";

export const OpeningHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo entrance: starts at 1s, spring scale 0 → 1
  const logoDelay = Math.round(fps * 1);
  const logoSpring = spring({
    frame,
    fps,
    delay: logoDelay,
    config: { damping: 15, stiffness: 100 },
  });

  const logoScale = interpolate(logoSpring, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  const logoOpacity = interpolate(logoSpring, [0, 0.3], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Glow pulse behind logo (starts before logo appears)
  const glowStart = Math.round(fps * 0.3);
  const glowOpacity =
    frame >= glowStart
      ? interpolate(
          Math.sin(((frame - glowStart) / fps) * Math.PI * 0.8),
          [-1, 1],
          [0.02, 0.08]
        )
      : 0;

  return (
    <AbsoluteFill>
      <GlowBackground />

      {/* Central orange glow pulse */}
      <div
        style={{
          position: "absolute",
          top: "35%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "50%",
          height: "50%",
          background: `radial-gradient(ellipse, rgba(234,88,12,${glowOpacity}) 0%, transparent 60%)`,
        }}
      />

      {/* Logo */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          paddingBottom: 60,
        }}
      >
        <Img
          src={staticFile("branding/photon-brothers-logo-mixed-white.svg")}
          style={{
            width: 400,
            height: "auto",
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
          }}
        />
      </AbsoluteFill>

      {/* Subtitle text — appears after logo settles */}
      <Sequence from={Math.round(fps * 2.5)} premountFor={fps}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            paddingTop: 100,
          }}
        >
          <TextReveal
            text="Introducing the PB Tech Ops Suite"
            fontSize={28}
            fontWeight={400}
            color={COLORS.textSecondary}
            letterSpacing={2}
            textTransform="uppercase"
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/scenes/OpeningHook.tsx
git commit -m "feat(remotion): add OpeningHook scene (Scene 1)"
```

---

### Task 14: TheProblem Scene (Scene 2)

**Files:**
- Create: `remotion/scenes/TheProblem.tsx`

- [ ] **Step 1: Create TheProblem.tsx**

Scene 2 (8s = 240 frames): Three system icons (HubSpot, Zuper, Zoho) scatter apart, text appears, then icons converge with spring physics into a unified PB icon.

```tsx
// remotion/scenes/TheProblem.tsx
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { TextReveal } from "../components/TextReveal";
import { COLORS, FONT_FAMILY } from "../lib/constants";

type SystemIconProps = {
  label: string;
  color: string;
  x: number;
  y: number;
};

const SystemIcon: React.FC<SystemIconProps> = ({ label, color, x, y }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: `calc(50% + ${x}px)`,
        top: `calc(45% + ${y}px)`,
        transform: "translate(-50%, -50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      {/* Icon circle */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: `${color}20`,
          border: `2px solid ${color}`,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          boxShadow: `0 0 30px ${color}40`,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            backgroundColor: color,
          }}
        />
      </div>
      {/* Label */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color,
          fontFamily: FONT_FAMILY,
          letterSpacing: 1,
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
};

const SYSTEMS = [
  { label: "HubSpot", color: "#ff7a59" },
  { label: "Zuper", color: COLORS.accentGreen },
  { label: "Zoho", color: COLORS.accentBlue },
];

// Scattered positions (spread apart)
const SCATTERED = [
  { x: -250, y: -40 },
  { x: 0, y: 60 },
  { x: 250, y: -40 },
];

export const TheProblem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Phase 1: Icons scatter in (0s–1s)
  const scatterIn = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 80 },
  });

  // Phase 2: Converge to center (4s–6s)
  const convergeDelay = Math.round(fps * 4);
  const converge = spring({
    frame,
    fps,
    delay: convergeDelay,
    config: { damping: 12, stiffness: 60 },
  });

  // Phase 3: Merged icon scale (after converge)
  const mergedScale = interpolate(converge, [0.8, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <GlowBackground />

      {/* System icons — scatter then converge */}
      {SYSTEMS.map((system, i) => {
        const scatterX = SCATTERED[i].x;
        const scatterY = SCATTERED[i].y;

        // Current position: scattered position → center (0, 0)
        const currentX = interpolate(converge, [0, 1], [scatterX, 0], {
          extrapolateRight: "clamp",
        });
        const currentY = interpolate(converge, [0, 1], [scatterY, 0], {
          extrapolateRight: "clamp",
        });

        const iconOpacity = interpolate(
          scatterIn,
          [0, 1],
          [0, 1],
          { extrapolateRight: "clamp" }
        );

        // Fade out individual icons as they merge
        const iconFade = interpolate(converge, [0.7, 1], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div key={system.label} style={{ opacity: iconOpacity * iconFade }}>
            <SystemIcon
              label={system.label}
              color={system.color}
              x={currentX * scatterIn}
              y={currentY * scatterIn}
            />
          </div>
        );
      })}

      {/* Merged PB icon (appears after convergence) */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          paddingBottom: 40,
        }}
      >
        <div
          style={{
            opacity: mergedScale,
            transform: `scale(${mergedScale})`,
            width: 80,
            height: 80,
            borderRadius: 40,
            background: `linear-gradient(135deg, ${COLORS.pbOrange}, ${COLORS.accentPurple})`,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            boxShadow: `0 0 60px ${COLORS.pbOrange}60`,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: COLORS.textPrimary,
              fontFamily: FONT_FAMILY,
            }}
          >
            PB
          </div>
        </div>
      </AbsoluteFill>

      {/* Text: appears at ~1.5s */}
      <Sequence from={Math.round(fps * 1.5)} durationInFrames={Math.round(fps * 4)} premountFor={fps}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            paddingTop: 200,
          }}
        >
          <TextReveal
            text="Three systems. No single source of truth."
            fontSize={24}
            fontWeight={500}
            color={COLORS.textSecondary}
            letterSpacing={0.5}
          />
        </AbsoluteFill>
      </Sequence>

      {/* New text after merge */}
      <Sequence from={Math.round(fps * 6)} premountFor={fps}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            paddingTop: 180,
          }}
        >
          <TextReveal
            text="Until now."
            fontSize={28}
            fontWeight={700}
            color={COLORS.textPrimary}
            glowColor={`${COLORS.pbOrange}80`}
          />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/scenes/TheProblem.tsx
git commit -m "feat(remotion): add TheProblem scene (Scene 2)"
```

---

### Task 15: FeatureShowcase Scene (Scenes 3–8)

**Files:**
- Create: `remotion/scenes/FeatureShowcase.tsx`

- [ ] **Step 1: Create FeatureShowcase.tsx**

This is the parameterized component that handles Scenes 3 through 8. Each instance receives a config with optional title card, video source, overlay labels, and accent color.

```tsx
// remotion/scenes/FeatureShowcase.tsx
import {
  AbsoluteFill,
  Sequence,
  useVideoConfig,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { TitleCard } from "../components/TitleCard";
import { ScreenFrame } from "../components/ScreenFrame";
import { OverlayLabel } from "../components/OverlayLabel";
import type { FeatureShowcaseConfig } from "../lib/types";

export const FeatureShowcase: React.FC<FeatureShowcaseConfig> = ({
  accentColor,
  titleCard,
  titleCardFrames = 60,
  videoSrc,
  overlays = [],
  videoTrimBefore,
  videoTrimAfter,
  videoPlaybackRate,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const recordingStart = titleCard ? titleCardFrames : 0;
  const recordingDuration = durationInFrames - recordingStart;

  return (
    <AbsoluteFill>
      <GlowBackground />

      {/* Title Card (optional, shown before recording) */}
      {titleCard && (
        <Sequence
          durationInFrames={titleCardFrames}
          premountFor={fps}
        >
          <TitleCard
            label={titleCard.label}
            headline={titleCard.headline}
            subtitle={titleCard.subtitle}
            accentColor={accentColor}
          />
        </Sequence>
      )}

      {/* Screen Recording */}
      <Sequence
        from={recordingStart}
        durationInFrames={recordingDuration}
        premountFor={fps}
      >
        <ScreenFrame
          videoSrc={videoSrc}
          trimBefore={videoTrimBefore}
          trimAfter={videoTrimAfter}
          playbackRate={videoPlaybackRate}
        />

        {/* Overlay labels positioned relative to recording start */}
        {overlays.map((overlay, i) => (
          <Sequence
            key={`${overlay.text}-${i}`}
            from={overlay.startFrame}
            durationInFrames={overlay.durationFrames}
            layout="none"
            premountFor={Math.round(fps * 0.5)}
          >
            <OverlayLabel
              text={overlay.text}
              accentColor={accentColor}
              position={overlay.position}
            />
          </Sequence>
        ))}
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/scenes/FeatureShowcase.tsx
git commit -m "feat(remotion): add FeatureShowcase parameterized scene (Scenes 3-8)"
```

---

### Task 16: Montage Scene (Scene 9)

**Files:**
- Create: `remotion/scenes/Montage.tsx`

- [ ] **Step 1: Create Montage.tsx**

Scene 9 (12s = 360 frames): Rapid-fire dashboard screenshots (7s = 210 frames) with crossfade transitions, then stats slam (5s = 150 frames) with animated counters.

```tsx
// remotion/scenes/Montage.tsx
import {
  AbsoluteFill,
  Img,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  staticFile,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { StatCounter } from "../components/StatCounter";
import { TextReveal } from "../components/TextReveal";
import { COLORS, FONT_FAMILY, MONTAGE_DASHBOARDS, MONTAGE_STATS } from "../lib/constants";

/** Single dashboard flash with crossfade */
const DashboardFlash: React.FC<{
  imageSrc: string;
  label: string;
}> = ({ imageSrc, label }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Fade in over first 8 frames
  const fadeIn = interpolate(frame, [0, 8], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Fade out over last 8 frames
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 8, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const opacity = Math.min(fadeIn, fadeOut);

  // Subtle zoom
  const scale = interpolate(frame, [0, durationInFrames], [1.05, 1], {
    extrapolateRight: "clamp",
  });

  // Check if it's a placeholder (no real file)
  const isPlaceholder = !imageSrc || imageSrc.includes(".gitkeep");

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Dashboard image */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            transform: `scale(${scale * 0.85})`,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
            border: "1px solid rgba(255,255,255,0.08)",
            width: 1920,
            height: 1080,
            backgroundColor: "#111118",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {isPlaceholder ? (
            <div
              style={{
                color: COLORS.textTertiary,
                fontSize: 24,
                fontFamily: FONT_FAMILY,
                fontWeight: 600,
              }}
            >
              {label}
            </div>
          ) : (
            <Img
              src={staticFile(imageSrc)}
              style={{
                width: 1920,
                height: 1080,
                objectFit: "cover",
              }}
            />
          )}
        </div>
      </AbsoluteFill>

      {/* Label overlay */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 24px",
          borderRadius: 6,
          backgroundColor: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${COLORS.pbOrange}40`,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: COLORS.textPrimary,
            fontFamily: FONT_FAMILY,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Montage: React.FC = () => {
  const { fps } = useVideoConfig();

  // Dashboard montage: 7 dashboards in 7s (210 frames)
  // Each dashboard gets 30 frames = 1s
  const dashboardDuration = 30;
  const montageTotalFrames = 210;

  // Stats section: starts at frame 210, runs for 150 frames (5s)
  const statsStart = montageTotalFrames;
  const statDelay = Math.round(fps * 0.5); // 0.5s between each stat

  return (
    <AbsoluteFill>
      <GlowBackground showOrangeGlow />

      {/* Dashboard rapid-fire montage */}
      {MONTAGE_DASHBOARDS.map((dashboard, i) => (
        <Sequence
          key={dashboard.label}
          from={i * dashboardDuration}
          durationInFrames={dashboardDuration}
          premountFor={10}
        >
          <DashboardFlash
            imageSrc={dashboard.imageSrc}
            label={dashboard.label}
          />
        </Sequence>
      ))}

      {/* Stats slam */}
      <Sequence from={statsStart} premountFor={fps}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 32,
            }}
          >
            {MONTAGE_STATS.map((stat, i) => (
              <Sequence
                key={stat.suffix}
                from={i * statDelay}
                layout="none"
                premountFor={fps}
              >
                <StatCounter
                  value={stat.value}
                  prefix={stat.prefix}
                  suffix={stat.suffix}
                  color={stat.color}
                />
              </Sequence>
            ))}
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/scenes/Montage.tsx
git commit -m "feat(remotion): add Montage scene (Scene 9)"
```

---

### Task 17: Closing Scene (Scene 10)

**Files:**
- Create: `remotion/scenes/Closing.tsx`

- [ ] **Step 1: Create Closing.tsx**

Scene 10 (7s = 210 frames): PB logo returns to center with spring animation → "pbtechops.com" fades in with orange glow → hold → fade to black.

```tsx
// remotion/scenes/Closing.tsx
import {
  AbsoluteFill,
  Img,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  staticFile,
} from "remotion";
import { GlowBackground } from "../components/GlowBackground";
import { COLORS, FONT_FAMILY } from "../lib/constants";

export const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Logo entrance spring
  const logoSpring = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 100 },
  });

  const logoScale = interpolate(logoSpring, [0, 1], [0.5, 1], {
    extrapolateRight: "clamp",
  });

  const logoOpacity = interpolate(logoSpring, [0, 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  // URL entrance (appears after logo settles, ~1.5s)
  const urlDelay = Math.round(fps * 1.5);
  const urlSpring = spring({
    frame,
    fps,
    delay: urlDelay,
    config: { damping: 200 },
  });

  const urlOpacity = interpolate(urlSpring, [0, 1], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Fade to black (last 1.5s)
  const fadeOutStart = durationInFrames - Math.round(fps * 1.5);
  const fadeToBlack = interpolate(
    frame,
    [fadeOutStart, durationInFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <GlowBackground showOrangeGlow />

      {/* Logo */}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          paddingBottom: 40,
        }}
      >
        <Img
          src={staticFile("branding/photon-brothers-logo-mixed-white.svg")}
          style={{
            width: 350,
            height: "auto",
            transform: `scale(${logoScale})`,
            opacity: logoOpacity,
          }}
        />
      </AbsoluteFill>

      {/* URL */}
      <Sequence from={urlDelay} premountFor={fps}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            paddingTop: 120,
          }}
        >
          <div
            style={{
              opacity: urlOpacity,
              fontSize: 28,
              fontWeight: 600,
              color: COLORS.pbOrange,
              fontFamily: FONT_FAMILY,
              letterSpacing: 2,
              textShadow: `0 0 40px ${COLORS.pbOrange}80, 0 0 80px ${COLORS.pbOrange}40`,
            }}
          >
            pbtechops.com
          </div>
        </AbsoluteFill>
      </Sequence>

      {/* Fade to black overlay */}
      <AbsoluteFill
        style={{
          backgroundColor: "#000000",
          opacity: fadeToBlack,
        }}
      />
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Commit**

```bash
git add remotion/scenes/Closing.tsx
git commit -m "feat(remotion): add Closing scene (Scene 10)"
```

---

## Chunk 4: Orchestrator, Audio & Production

### Task 18: Wire Up WalkthroughVideo Orchestrator

**Files:**
- Modify: `remotion/WalkthroughVideo.tsx` (replace placeholder)

- [ ] **Step 1: Replace WalkthroughVideo.tsx with full orchestrator**

This connects all 10 scenes using `<TransitionSeries>` with fade transitions between each scene.

```tsx
// remotion/WalkthroughVideo.tsx
import { AbsoluteFill } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile, useVideoConfig, interpolate } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";

import { OpeningHook } from "./scenes/OpeningHook";
import { TheProblem } from "./scenes/TheProblem";
import { FeatureShowcase } from "./scenes/FeatureShowcase";
import { Montage } from "./scenes/Montage";
import { Closing } from "./scenes/Closing";
import {
  SCENE_FRAMES,
  TRANSITION_FRAMES,
  FEATURE_SCENES,
} from "./lib/constants";

const TRANSITION_TIMING = linearTiming({
  durationInFrames: TRANSITION_FRAMES,
});

const FADE_TRANSITION = fade();

/**
 * Optional audio wrapper that only renders if the music file exists.
 * During development, the music file may not be present.
 */
const BackgroundMusic: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  // Fade in over first 2 seconds
  const fadeInEnd = fps * 2;
  // Fade out over last 3 seconds
  const fadeOutStart = durationInFrames - fps * 3;

  return (
    <Audio
      src={staticFile("remotion/music/background.mp3")}
      volume={(f) => {
        const fadeIn = interpolate(f, [0, fadeInEnd], [0, 0.4], {
          extrapolateRight: "clamp",
        });
        const fadeOut = interpolate(
          f,
          [fadeOutStart, durationInFrames],
          [0.4, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );
        return Math.min(fadeIn, fadeOut);
      }}
    />
  );
};

export const WalkthroughVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <TransitionSeries>
        {/* Scene 1: Opening Hook (8s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.openingHook}
        >
          <OpeningHook />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 2: The Problem (8s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.theProblem}
        >
          <TheProblem />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 3: Login → Home → Deals (18s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.loginHomeDealsContinuous}
        >
          <FeatureShowcase {...FEATURE_SCENES[0]} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 4: Deals → Home → Ops Suite (12s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.dealsHomeOpsSuite}
        >
          <FeatureShowcase {...FEATURE_SCENES[1]} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 5: Product Submission + AI (14s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.productSubmission}
        >
          <FeatureShowcase {...FEATURE_SCENES[2]} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 6: BOM & Sales Order (14s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.bomSalesOrder}
        >
          <FeatureShowcase {...FEATURE_SCENES[3]} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 7: Scheduling — Power Scene (18s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.scheduling}
        >
          <FeatureShowcase {...FEATURE_SCENES[4]} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 8: SOP Guide (12s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.sopGuide}
        >
          <FeatureShowcase {...FEATURE_SCENES[5]} />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 9: Montage + Stats (12s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.montage}
        >
          <Montage />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition
          presentation={FADE_TRANSITION}
          timing={TRANSITION_TIMING}
        />

        {/* Scene 10: Closing + CTA (7s) */}
        <TransitionSeries.Sequence
          durationInFrames={SCENE_FRAMES.closing}
        >
          <Closing />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/*
       * Background Music
       * Comment this out during development if no music file exists.
       * Uncomment when public/remotion/music/background.mp3 is present.
       */}
      {/* <BackgroundMusic /> */}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 2: Verify in Studio**

Run:
```bash
npx remotion studio remotion/Root.tsx
```

Expected: Full video plays through all 10 scenes with fade transitions. RecordingPlaceholders appear for all screen recording scenes. Animated scenes (OpeningHook, TheProblem, Montage, Closing) play their full animations. Total duration should be ~118.5s (3555 frames) due to transition overlaps.

- [ ] **Step 3: Commit**

```bash
git add remotion/WalkthroughVideo.tsx
git commit -m "feat(remotion): wire up full WalkthroughVideo orchestrator with all 10 scenes"
```

---

### Task 19: Add Individual Scene Compositions for Preview

**Files:**
- Modify: `remotion/Root.tsx`

- [ ] **Step 1: Register individual scene compositions for easier development**

Add individual `<Composition>` entries for each scene so they can be previewed in isolation during development. This makes it much faster to iterate on individual scenes.

```tsx
// remotion/Root.tsx
import "./index.css";
import { Composition, Folder } from "remotion";
import { WalkthroughVideo } from "./WalkthroughVideo";
import { OpeningHook } from "./scenes/OpeningHook";
import { TheProblem } from "./scenes/TheProblem";
import { FeatureShowcase } from "./scenes/FeatureShowcase";
import { Montage } from "./scenes/Montage";
import { Closing } from "./scenes/Closing";
import {
  FPS,
  WIDTH,
  HEIGHT,
  SCENE_FRAMES,
  TRANSITION_FRAMES,
  FEATURE_SCENES,
} from "./lib/constants";

const sceneDurations = Object.values(SCENE_FRAMES);
const totalFrames =
  sceneDurations.reduce((sum, d) => sum + d, 0) -
  (sceneDurations.length - 1) * TRANSITION_FRAMES;

// Named wrappers for FeatureShowcase scenes (avoids inline arrow fns in Composition)
const Scene3 = () => <FeatureShowcase {...FEATURE_SCENES[0]} />;
const Scene4 = () => <FeatureShowcase {...FEATURE_SCENES[1]} />;
const Scene5 = () => <FeatureShowcase {...FEATURE_SCENES[2]} />;
const Scene6 = () => <FeatureShowcase {...FEATURE_SCENES[3]} />;
const Scene7 = () => <FeatureShowcase {...FEATURE_SCENES[4]} />;
const Scene8 = () => <FeatureShowcase {...FEATURE_SCENES[5]} />;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Full video */}
      <Composition
        id="WalkthroughVideo"
        component={WalkthroughVideo}
        durationInFrames={totalFrames}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
      />

      {/* Individual scenes for preview */}
      <Folder name="Scenes">
        <Composition
          id="Scene1-OpeningHook"
          component={OpeningHook}
          durationInFrames={SCENE_FRAMES.openingHook}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene2-TheProblem"
          component={TheProblem}
          durationInFrames={SCENE_FRAMES.theProblem}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene3-LoginHomeDeals"
          component={Scene3}
          durationInFrames={SCENE_FRAMES.loginHomeDealsContinuous}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene4-DealsHomeOps"
          component={Scene4}
          durationInFrames={SCENE_FRAMES.dealsHomeOpsSuite}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene5-ProductSubmission"
          component={Scene5}
          durationInFrames={SCENE_FRAMES.productSubmission}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene6-BomSalesOrder"
          component={Scene6}
          durationInFrames={SCENE_FRAMES.bomSalesOrder}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene7-Scheduling"
          component={Scene7}
          durationInFrames={SCENE_FRAMES.scheduling}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene8-SOPGuide"
          component={Scene8}
          durationInFrames={SCENE_FRAMES.sopGuide}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene9-Montage"
          component={Montage}
          durationInFrames={SCENE_FRAMES.montage}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
        <Composition
          id="Scene10-Closing"
          component={Closing}
          durationInFrames={SCENE_FRAMES.closing}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
        />
      </Folder>
    </>
  );
};
```

- [ ] **Step 2: Verify in Studio**

Run:
```bash
npx remotion studio remotion/Root.tsx
```

Expected: Sidebar shows "WalkthroughVideo" at top level and a "Scenes" folder with all 10 individual scenes. Each scene can be selected and previewed independently.

- [ ] **Step 3: Commit**

```bash
git add remotion/Root.tsx
git commit -m "feat(remotion): add individual scene compositions for isolated preview"
```

---

### Task 20: Screen Recording Capture Guide

This is not a code task — it's a reference document for the manual recording process that must happen before the final render.

- [ ] **Step 1: Record the following screen captures**

All recordings should be captured on the live app at **pbtechops.com** with:
- Browser: Chrome, full screen, 1920x1080 resolution
- Dark mode enabled
- Clean browser chrome (hide bookmarks bar, minimal extensions)
- Screen recorder: OBS or QuickTime at 30fps, 1920x1080

| # | Filename | Start Page | Actions | Target Duration |
|---|----------|-----------|---------|----------------|
| 1 | `login-home-deals-ops.mp4` | Google login | Sign in → home loads → filter by location → scroll to bar chart → click a bar → Deals page loads → click a deal → detail panel → back to home → scroll to suites → click Operations Suite | ~30s (will be split across Scenes 3+4) |
| 2 | `product-submission.mp4` | Ops Suite nav | Click Product Submission → wizard loads → upload spec sheet PDF → AI extraction runs → form auto-populates → open AI chat briefly | ~12s |
| 3 | `bom-sales-order.mp4` | Ops Suite nav | Click Planset BOM → upload planset → AI extraction progress → BOM table populates → SO generated | ~12s |
| 4 | `scheduling.mp4` | Ops Suite nav | Click Master Schedule → drag a job to new date → click Optimize → select preset → generated schedule preview → forecast ghosts visible → quick cut: switch to Site Survey Schedule → drag-drop | ~16s |
| 5 | `sop-guide.mp4` | Home page | Click SOP link → sidebar loads → click a section → scroll through procedure (show tags, status flows) → use search | ~10s |

**Montage screenshots** (static PNG, 1920x1080, dark mode):

| Filename | Dashboard |
|----------|-----------|
| `pipeline.png` | Pipeline Overview (`/dashboards/pipeline`) |
| `timeline.png` | Timeline View (`/dashboards/timeline`) |
| `equipment.png` | Equipment Backlog (`/dashboards/equipment-backlog`) |
| `permitting.png` | Permitting & IC (`/dashboards/permitting-interconnection`) |
| `forecast-accuracy.png` | Forecast Accuracy (`/dashboards/forecast-accuracy`) |
| `forecast-timeline.png` | Forecast Timeline (`/dashboards/forecast-timeline`) |
| `revenue.png` | Revenue Dashboard (`/dashboards/revenue`) |

Place recordings in `public/remotion/recordings/` and screenshots in `public/remotion/montage/`.

- [ ] **Step 2: Source background music**

Find a royalty-free cinematic/upbeat track (~2 minutes). Recommended sources:
- [Pixabay Music](https://pixabay.com/music/) (free, no attribution)
- [Uppbeat](https://uppbeat.io/) (free tier available)
- [Epidemic Sound](https://www.epidemicsound.com/) (paid, high quality)

Search for: "cinematic technology", "modern corporate", "product launch"

Save as `public/remotion/music/background.mp3`.

- [ ] **Step 3: After adding recordings, uncomment the BackgroundMusic component**

In `remotion/WalkthroughVideo.tsx`, change:
```tsx
{/* <BackgroundMusic /> */}
```
to:
```tsx
<BackgroundMusic />
```

- [ ] **Step 4: Update video trim/speed values if recordings don't match target durations**

After recording, adjust the `FEATURE_SCENES` configs in `remotion/lib/constants.ts`:
- `videoTrimBefore` / `videoTrimAfter` on FeatureShowcase props to trim recordings
- `videoPlaybackRate` to speed up or slow down recordings
- Overlay `startFrame` values to align text with actual recording actions

For the Scene 3+4 split (one continuous recording), configure:
- Scene 3: uses `login-home-deals-ops.mp4` with `trimAfter` to cut at ~18s
- Scene 4: uses the same file with `trimBefore` to start at ~18s

---

### Task 21: Final Render

- [ ] **Step 1: Preview full video in Studio**

Run:
```bash
npx remotion studio remotion/Root.tsx
```

Watch the full WalkthroughVideo composition end-to-end. Verify:
- All scene transitions are smooth
- Screen recordings play at correct speed and are properly trimmed
- Overlay text appears at the right moments during recordings
- Stats count up correctly in the montage
- Music fades in/out appropriately
- Total runtime is ~118.5s (~2 minutes), well under the 2:15 ceiling

- [ ] **Step 2: Render the final video**

Run:
```bash
npx remotion render remotion/Root.tsx WalkthroughVideo out/walkthrough-video.mp4 --codec h264
```

Expected: `out/walkthrough-video.mp4` is created. File plays as a polished cinematic video.

- [ ] **Step 3: Commit all final adjustments**

```bash
git add remotion/ remotion.config.ts
git commit -m "feat(remotion): complete walkthrough video composition — ready for render"
```
