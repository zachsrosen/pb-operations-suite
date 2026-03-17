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
