# PB Tech Ops Suite — Walkthrough Video Design Spec

## Overview

A ~120-second cinematic product launch video introducing the PB Tech Ops Suite to Photon Brothers leadership. Accompanies the announcement email as an embedded/linked asset.

## Decisions

| Decision | Choice |
|----------|--------|
| Format | ~120s cinematic product launch video |
| Structure | Feature cascade with extended feature time + continuous user journey |
| Visuals | Real screen recordings of the live app |
| Audio | Music track only, no voiceover. Text overlays carry messaging. |
| Tone | Product launch / hype — dark theme, bold typography, dramatic reveals |
| Tool | Remotion (re-install packages, new composition) |
| Resolution | 1920x1080, 30fps |

## Visual Style

### Color Palette

| Role | Color | Hex |
|------|-------|-----|
| Background | Deep navy/black | `#0a0a1a` |
| PB Orange (primary) | Orange | `#ea580c` |
| Accent Purple | Purple | `#8b5cf6` |
| Success Green | Green | `#22c55e` |
| Accent Cyan | Cyan | `#06b6d4` |
| Accent Amber | Amber | `#f59e0b` |
| Accent Blue | Blue | `#3b82f6` |
| Text Primary | White | `#ffffff` |
| Text Secondary | Slate | `#94a3b8` |
| Text Tertiary | Dark slate | `#64748b` |

### Atmosphere

- Background: radial gradient from `#1a1a3e` center to `#0a0a1a` edges to `#050510` corners
- Subtle grid overlay: `rgba(139,92,246,0.03)` lines at 60px intervals
- Orange glow spot at top center for key moments
- Text shadows for glow effects: `0 0 40px rgba(color, 0.5)`

### Typography

- Font: `-apple-system, BlinkMacSystemFont, sans-serif` (matches app)
- Labels: 11px, weight 700, letter-spacing 4px, uppercase, accent color
- Headlines: 36-42px, weight 800, white, letter-spacing -0.5px
- Supporting text: 16-18px, weight 400, `#94a3b8`
- Stat numbers: 48px, weight 800, white, with colored unit labels

### Feature Title Card Pattern

Each feature gets a title card with:
- Accent color bar on left edge (4px, color changes per feature)
- Category label (uppercase, accent color)
- Headline (28px, white, bold)
- Subtitle (14px, `#64748b`)
- Spring-animated in, holds for ~2 seconds
- Transitions to screen recording with scale/fade

### Screen Recording Frame

Screen recordings are presented inside a cinematic frame:
- Dark border/shadow around the recording
- Slight scale (0.85-0.9) to show the frame context
- Smooth zoom-in transitions to focus on interactions
- Text overlays appear as floating labels during recordings

## Scene Breakdown

### Scene 1: Opening Hook + Logo Reveal (8s)

- Dark screen, PB orange glow pulses in center
- Photon Brothers logo fades in with spring animation (scale 0→1)
- Text reveals below: "Introducing the PB Tech Ops Suite"
- Subtle particle/grid background

**Animation:** Logo scale spring, text fadeIn + slideUp, background glow pulse

### Scene 2: The Problem (8s)

- Three system icons/logos appear and scatter apart: HubSpot (orange), Zuper (green), Zoho (blue)
- Text: "Three systems. No single source of truth."
- Icons converge with spring physics and merge into a unified PB Tech Ops icon

**Animation:** Icons scatter → converge with spring physics, text fade

### Scene 3: Login → Home Page → Bar Chart → Deals (18s)

**Title card (2s):** "Your command center."

**One continuous screen recording (16s):**
1. Google OAuth login screen → click sign in
2. Home page loads — stat cards animate in with live data (total projects, total value, PE count, RTB count)
3. Filter by location — data updates in real time
4. Scroll down to stage bar chart
5. Click a bar → navigates to Active Deals page filtered to that stage

### Scene 4: Active Deals → Back to Home → Operations Suite (12s)

**Title card (2s):** None — continues naturally from Scene 3.

**Continues from Scene 3 (same recording or clean cut, 10s):**
1. On Deals page — click a deal → detail panel opens showing project status
2. Navigate back to home page
3. Scroll to suite cards — show Operations, D&E, P&I, Executive, Service+D&R, AI Skills
4. Click into **Operations Suite** → grouped dashboard list loads

This establishes the suite navigation pattern. The next three features (Scenes 5-7) all launch from within this Operations Suite view.

### Scene 5: Product Submission + AI (14s)

**Origin shot (1-2s):** Click from Operations Suite nav into Product Submission

**Screen recording (12s):**
1. Product submission wizard loads
2. Upload a manufacturer spec sheet PDF
3. AI extraction spinner runs
4. Form auto-populates with extracted data (brand, model, specs, pricing)
5. **AI Chat:** Pop open the AI chat from within this page to show it's available everywhere (2-3s moment)

**Overlay text:** "AI-powered product creation"
**Accent color:** Purple (`#8b5cf6`)

### Scene 6: Automated BOM & Sales Order (14s)

**Origin shot (1-2s):** Click from Operations Suite nav

**Screen recording (12s):**
1. Planset upload
2. AI reads the plans — extraction progress
3. BOM table populates with matched products
4. Sales Order generated

**Overlay text:** "Live on Ready To Build deals"
**Accent color:** Green (`#22c55e`)

### Scene 7: Scheduling — Power Scene (18s)

**Origin shot (1-2s):** Click from Operations Suite nav into Master Schedule

**Title card overlay:** "Drag. Drop. Scheduled."

**Screen recording (16s) — the centerpiece:**
1. Master Schedule calendar view with jobs visible
2. Drag a job to a new date — see it reschedule with Zuper sync
3. Click "Optimize" button → preset selector appears (balanced/revenue/urgency)
4. Generated optimized schedule preview with project list and revenue total
5. Forecast data visible on the calendar (ghost entries, projected dates)
6. Quick cut to Site Survey Schedule showing drag-and-drop

**Overlay text sequence during recording:**
- "Drag. Drop. Scheduled." (during drag-drop, 2s)
- "AI-optimized scheduling" (during optimizer, 2s)
- "Built-in forecasting" (during forecast ghosts, 2s)

**Accent color:** Cyan (`#06b6d4`)

### Scene 8: SOP Guide (12s)

**Origin shot (1-2s):** Navigate from home page (SOP lives outside Operations Suite)

**Title card overlay:** "Every process. Documented."

**Screen recording (10s):**
1. SOP guide loads with sidebar navigation showing all sections
2. Click into a section
3. Scroll through procedure showing tags (AUTO, MANUAL, TRIGGER, ZUPER), status flows, and tables
4. Use the search feature to find a topic

**Accent color:** Amber (`#f59e0b`)

### Scene 9: Suite Montage + Stats (12s)

**Rapid-fire montage (7s):** ~1-second flashes of dashboards sliding in and out with crossfade transitions:
- Pipeline Overview
- Timeline View
- Equipment Backlog
- Permitting & Interconnection
- Forecast Accuracy
- Forecast Timeline
- Revenue Dashboard

Each dashboard gets ~1s on screen. Crossfade transitions overlap so 7 items fit within 7 seconds.

**Stats slam (5s):** Numbers animate in one by one with counter animation:
- "65+ dashboards"
- "1,376 scheduler views"
- "24 team members"

**Stats source:** Queried from `ActivityLog` table on 2026-03-16. Frozen at these values for the video — do not re-query at render time.

### Scene 10: Closing + CTA (7s)

- PB logo returns to center with spring animation
- "pbtechops.com" fades in below with orange glow
- Hold for 3 seconds
- Fade to black

## Screen Recordings Needed

| # | Recording | Starts From → Destination | Actions to Capture |
|---|-----------|--------------------------|-------------------|
| 1 | Login → Home → Deals → Home → Ops Suite | Login page → `/` → `/dashboards/deals` → `/` → `/suites/operations` | Login, stat cards, location filter, bar chart click, deal detail panel, back to home, suite cards, click into Ops |
| 2 | Product Submission + AI Chat | `/suites/operations` → `/dashboards/submit-product` | Start on Ops Suite nav, click Product Submission link, wizard flow, PDF upload, AI extraction, AI chat popup |
| 3 | BOM & SO Creation | `/suites/operations` → `/dashboards/bom` | Start on Ops Suite nav, click Planset BOM link, planset upload, BOM extraction, SO generation |
| 4 | Master Schedule + Optimizer + Forecast | `/suites/operations` → `/dashboards/scheduler` | Start on Ops Suite nav, click Master Schedule link, drag-drop, Optimize button, preset, generated schedule, forecast ghosts |
| 5 | Site Survey Schedule | `/dashboards/site-survey-scheduler` | Quick drag-drop demo (no origin shot needed, cut from Scene 7) |
| 6 | SOP Guide | `/` → `/sop` | Start on home page, click SOP link, sidebar nav, click section, scroll procedure, search |
| 7 | Montage captures (can be static screenshots) | Various dashboards | Pipeline, Timeline, Equipment, Permitting, Forecast Accuracy, Forecast Timeline, Revenue |

## Remotion Architecture

### Dependencies to Re-install

```bash
npm install remotion @remotion/cli @remotion/player
```

### File Structure

```
remotion/
├── Root.tsx                    # Composition registration
├── WalkthroughVideo.tsx        # Main composition (orchestrates all scenes)
├── scenes/
│   ├── OpeningHook.tsx         # Scene 1 — logo reveal
│   ├── TheProblem.tsx          # Scene 2 — system icons converge
│   ├── FeatureShowcase.tsx     # Scenes 3-8 — parameterized: { accentColor, titleCard, overlayText, videoSrc, originClipSrc? }
│   ├── Montage.tsx             # Scene 9 — rapid dashboard flashes + stats
│   └── Closing.tsx             # Scene 10 — CTA
├── components/
│   ├── TitleCard.tsx           # Reusable title card with accent bar
│   ├── StatCounter.tsx         # Animated number counter
│   ├── TextReveal.tsx          # Spring-animated text reveal
│   ├── GlowBackground.tsx     # Dark atmosphere with grid + glow
│   ├── ScreenFrame.tsx         # Frame wrapper for screen recordings
│   └── SceneTransition.tsx     # Shared fade/scale transition between scenes
├── assets/
│   ├── recordings/             # Screen recording MP4s (captured manually)
│   ├── montage/                # Static screenshots for montage
│   └── music/                  # Background music track
└── remotion.config.ts          # Remotion configuration
```

### Composition Config

```tsx
// Root.tsx
<Composition
  id="WalkthroughVideo"
  component={WalkthroughVideo}
  durationInFrames={3690}  // ~123s at 30fps
  fps={30}
  width={1920}
  height={1080}
/>
```

### Animation Patterns

All scenes use standard Remotion APIs matching the previous compositions:
- `<AbsoluteFill>` — full-screen containers
- `<Sequence>` — timeline sequencing between scenes
- `<OffthreadVideo>` — embedding screen recordings
- `<Audio>` — background music track
- `spring()` — spring physics for logo/text reveals
- `interpolate()` — value interpolation for fades, scales, counters
- `Easing.out(Easing.cubic)` — smooth easing curves

### Scene Timing (frames at 30fps)

| Scene | Start Frame | Duration | Seconds |
|-------|-------------|----------|---------|
| 1. Opening Hook | 0 | 240 | 8s |
| 2. The Problem | 240 | 240 | 8s |
| 3. Login → Home → Deals | 480 | 540 | 18s |
| 4. Deals → Home → Ops Suite | 1020 | 360 | 12s |
| 5. Product Submission + AI | 1380 | 420 | 14s |
| 6. BOM & Sales Order | 1800 | 420 | 14s |
| 7. Scheduling (Power Scene) | 2220 | 540 | 18s |
| 8. SOP Guide | 2760 | 360 | 12s |
| 9. Montage + Stats | 3120 | 360 | 12s |
| 10. Closing + CTA | 3480 | 210 | 7s |
| **Total** | | **3690** | **~123s** |

## Production Workflow

1. **Capture screen recordings** — Record each flow listed above on the live app at pbtechops.com. Use a screen recorder at 1920x1080 or higher, dark mode enabled.
2. **Source music** — Select a royalty-free cinematic/upbeat track (~120s).
3. **Build Remotion composition** — Implement scenes, import recordings as `<OffthreadVideo>`, add title cards, transitions, and overlays.
4. **Preview and iterate** — Use `npx remotion preview` to review timing and pacing.
5. **Render** — `npx remotion render WalkthroughVideo out/walkthrough-video.mp4`

## Success Criteria

- Video feels cinematic and polished — on par with a SaaS product launch
- Each feature is clearly identifiable and its value is communicated via text overlays
- The continuous user journey (Scenes 3-4) demonstrates the platform feels cohesive, not like disconnected dashboards
- AI capabilities (chat, spec extraction, BOM) are highlighted as differentiators
- Adoption stats (1,376 views, 24 users) land as proof of traction
- pbtechops.com URL is memorable at the close
- Total runtime stays under 2 minutes 15 seconds (~123s target)
