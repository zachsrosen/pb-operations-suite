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
