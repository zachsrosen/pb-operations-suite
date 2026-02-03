import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from "remotion";

export const LaunchVideo: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: "#0a0a0f",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Opening Hook */}
      <Sequence from={0} durationInFrames={120}>
        <OpeningHook />
      </Sequence>

      {/* Problem Statement */}
      <Sequence from={120} durationInFrames={150}>
        <ProblemStatement />
      </Sequence>

      {/* Solution Reveal */}
      <Sequence from={270} durationInFrames={90}>
        <SolutionReveal />
      </Sequence>

      {/* Feature Showcase - Command Center */}
      <Sequence from={360} durationInFrames={150}>
        <FeatureShowcase
          title="Unified Command Center"
          subtitle="See your entire pipeline at a glance"
          icon="🎯"
          color="#8b5cf6"
          stats={[
            { value: "715", label: "Projects Tracked" },
            { value: "$29M", label: "Pipeline Value" },
            { value: "5", label: "Locations" },
          ]}
        />
      </Sequence>

      {/* Feature Showcase - Scheduler */}
      <Sequence from={510} durationInFrames={150}>
        <FeatureShowcase
          title="Intelligent Scheduling"
          subtitle="Optimize crew assignments automatically"
          icon="📅"
          color="#22c55e"
          stats={[
            { value: "68", label: "Ready to Build" },
            { value: "Auto", label: "Conflict Detection" },
            { value: "Real-time", label: "Updates" },
          ]}
        />
      </Sequence>

      {/* Feature Showcase - PE Dashboard */}
      <Sequence from={660} durationInFrames={150}>
        <FeatureShowcase
          title="Participate Energy Tracking"
          subtitle="Never miss a milestone deadline"
          icon="⚡"
          color="#f59e0b"
          stats={[
            { value: "150+", label: "PE Projects" },
            { value: "3", label: "Milestone Types" },
            { value: "Alerts", label: "Overdue Tracking" },
          ]}
        />
      </Sequence>

      {/* Live Data Integration */}
      <Sequence from={810} durationInFrames={120}>
        <LiveDataScene />
      </Sequence>

      {/* Results/Impact */}
      <Sequence from={930} durationInFrames={150}>
        <ResultsScene />
      </Sequence>

      {/* Call to Action */}
      <Sequence from={1080} durationInFrames={120}>
        <CallToAction />
      </Sequence>
    </AbsoluteFill>
  );
};

const OpeningHook: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const textReveal = interpolate(frame, [30, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const lineWidth = interpolate(frame, [60, 90], [0, 400], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const sunScale = spring({
    frame: frame - 20,
    fps,
    config: { damping: 50 },
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 70%)",
        opacity: fadeIn,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 120,
            marginBottom: 30,
            transform: `scale(${sunScale})`,
            filter: "drop-shadow(0 0 60px rgba(250, 204, 21, 0.4))",
          }}
        >
          ☀️
        </div>
        <h1
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: "#fff",
            margin: 0,
            opacity: textReveal,
            letterSpacing: "-2px",
          }}
        >
          What if managing
        </h1>
        <h1
          style={{
            fontSize: 72,
            fontWeight: 800,
            background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: "10px 0 0 0",
            opacity: textReveal,
            letterSpacing: "-2px",
          }}
        >
          solar operations
        </h1>
        <h1
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: "#fff",
            margin: "10px 0 0 0",
            opacity: textReveal,
            letterSpacing: "-2px",
          }}
        >
          was actually simple?
        </h1>
        <div
          style={{
            width: lineWidth,
            height: 4,
            background: "linear-gradient(90deg, #22c55e, #06b6d4)",
            margin: "40px auto 0",
            borderRadius: 2,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

const ProblemStatement: React.FC = () => {
  const frame = useCurrentFrame();

  const problems = [
    { text: "Scattered data across multiple systems", icon: "📊", delay: 0 },
    { text: "Missed deadlines and milestone dates", icon: "⏰", delay: 20 },
    { text: "Manual scheduling causing conflicts", icon: "📅", delay: 40 },
    { text: "No visibility into pipeline health", icon: "👁️", delay: 60 },
  ];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "#0a0a0f",
        padding: 100,
      }}
    >
      <div style={{ maxWidth: 1200 }}>
        <h2
          style={{
            fontSize: 48,
            color: "#ef4444",
            marginBottom: 60,
            fontWeight: 700,
            textAlign: "center",
            opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Sound familiar?
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
          {problems.map((problem, i) => {
            const opacity = interpolate(frame - problem.delay, [0, 20], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const x = interpolate(frame - problem.delay, [0, 20], [-50, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            });
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 25,
                  opacity,
                  transform: `translateX(${x}px)`,
                  background: "rgba(239, 68, 68, 0.1)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: 16,
                  padding: "25px 35px",
                }}
              >
                <span style={{ fontSize: 48 }}>{problem.icon}</span>
                <span style={{ fontSize: 32, color: "#fff", fontWeight: 500 }}>
                  {problem.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const SolutionReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 50 },
  });

  const glowOpacity = interpolate(frame, [30, 60], [0, 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #0f172a 0%, #0a0a0f 70%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34, 197, 94, 0.3) 0%, transparent 70%)",
          opacity: glowOpacity,
          filter: "blur(60px)",
        }}
      />
      <div style={{ textAlign: "center", transform: `scale(${scale})`, zIndex: 1 }}>
        <h1
          style={{
            fontSize: 80,
            fontWeight: 800,
            color: "#fff",
            margin: 0,
            letterSpacing: "-2px",
          }}
        >
          Introducing
        </h1>
        <h1
          style={{
            fontSize: 100,
            fontWeight: 800,
            background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: "20px 0 0 0",
            letterSpacing: "-3px",
          }}
        >
          PB Operations Suite
        </h1>
        <p
          style={{
            fontSize: 32,
            color: "#a1a1aa",
            marginTop: 30,
          }}
        >
          Your complete solar operations command center
        </p>
      </div>
    </AbsoluteFill>
  );
};

const FeatureShowcase: React.FC<{
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  stats: Array<{ value: string; label: string }>;
}> = ({ title, subtitle, icon, color, stats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const iconScale = spring({
    frame,
    fps,
    config: { damping: 60 },
  });

  const titleOpacity = interpolate(frame, [15, 35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${color}15 0%, #0a0a0f 50%)`,
        padding: 80,
      }}
    >
      <div style={{ display: "flex", height: "100%", gap: 80 }}>
        {/* Left side - Feature info */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div
            style={{
              fontSize: 100,
              marginBottom: 30,
              transform: `scale(${iconScale})`,
              filter: `drop-shadow(0 0 40px ${color}80)`,
            }}
          >
            {icon}
          </div>
          <h2
            style={{
              fontSize: 64,
              fontWeight: 700,
              color: "#fff",
              margin: 0,
              opacity: titleOpacity,
            }}
          >
            {title}
          </h2>
          <p
            style={{
              fontSize: 28,
              color: "#a1a1aa",
              marginTop: 20,
              opacity: titleOpacity,
            }}
          >
            {subtitle}
          </p>
        </div>

        {/* Right side - Stats */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 30,
          }}
        >
          {stats.map((stat, i) => {
            const delay = 30 + i * 15;
            const statScale = spring({
              frame: frame - delay,
              fps,
              config: { damping: 80 },
            });
            return (
              <div
                key={i}
                style={{
                  background: "rgba(255, 255, 255, 0.05)",
                  border: `2px solid ${color}50`,
                  borderRadius: 20,
                  padding: "35px 45px",
                  transform: `scale(${statScale})`,
                }}
              >
                <div style={{ fontSize: 56, fontWeight: 700, color }}>{stat.value}</div>
                <div style={{ fontSize: 22, color: "#a1a1aa", marginTop: 8 }}>{stat.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const LiveDataScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const integrations = [
    { name: "HubSpot CRM", icon: "🔗", color: "#ff7a59" },
    { name: "Real-time Sync", icon: "🔄", color: "#22c55e" },
    { name: "Auto Updates", icon: "⚡", color: "#f59e0b" },
    { name: "5-min Cache", icon: "💾", color: "#8b5cf6" },
  ];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "linear-gradient(180deg, #0a0a0f 0%, #0f172a 100%)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h2
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: "#fff",
            marginBottom: 20,
            opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Powered by Live Data
        </h2>
        <p
          style={{
            fontSize: 28,
            color: "#71717a",
            marginBottom: 60,
            opacity: interpolate(frame, [10, 30], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Direct HubSpot integration • Always up to date
        </p>
        <div style={{ display: "flex", gap: 30, justifyContent: "center" }}>
          {integrations.map((item, i) => {
            const delay = 20 + i * 12;
            const scale = spring({
              frame: frame - delay,
              fps,
              config: { damping: 80 },
            });
            return (
              <div
                key={i}
                style={{
                  background: `${item.color}15`,
                  border: `2px solid ${item.color}`,
                  borderRadius: 20,
                  padding: "40px 50px",
                  textAlign: "center",
                  transform: `scale(${scale})`,
                }}
              >
                <div style={{ fontSize: 60, marginBottom: 15 }}>{item.icon}</div>
                <div style={{ fontSize: 22, color: "#fff", fontWeight: 600 }}>{item.name}</div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const ResultsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const results = [
    { value: "$29M+", label: "Pipeline Tracked", color: "#22c55e" },
    { value: "715+", label: "Projects Managed", color: "#8b5cf6" },
    { value: "5", label: "Locations", color: "#06b6d4" },
    { value: "100%", label: "Visibility", color: "#f59e0b" },
  ];

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 70%)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h2
          style={{
            fontSize: 56,
            fontWeight: 700,
            color: "#fff",
            marginBottom: 60,
            opacity: interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" }),
          }}
        >
          Real Results for Photon Brothers
        </h2>
        <div style={{ display: "flex", gap: 50, justifyContent: "center" }}>
          {results.map((result, i) => {
            const delay = 20 + i * 15;
            const scale = spring({
              frame: frame - delay,
              fps,
              config: { damping: 60 },
            });
            return (
              <div
                key={i}
                style={{
                  textAlign: "center",
                  transform: `scale(${scale})`,
                }}
              >
                <div
                  style={{
                    fontSize: 80,
                    fontWeight: 800,
                    color: result.color,
                    textShadow: `0 0 60px ${result.color}60`,
                  }}
                >
                  {result.value}
                </div>
                <div style={{ fontSize: 24, color: "#a1a1aa", marginTop: 15 }}>{result.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const CallToAction: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 50 },
  });

  const buttonScale = spring({
    frame: frame - 40,
    fps,
    config: { damping: 60 },
  });

  const glowPulse = Math.sin(frame * 0.1) * 0.3 + 0.7;

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(ellipse at center, #0f172a 0%, #0a0a0f 70%)",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34, 197, 94, 0.2) 0%, transparent 70%)",
          opacity: glowPulse,
          filter: "blur(100px)",
        }}
      />
      <div style={{ textAlign: "center", transform: `scale(${scale})`, zIndex: 1 }}>
        <div
          style={{
            fontSize: 100,
            marginBottom: 30,
            filter: "drop-shadow(0 0 40px rgba(250, 204, 21, 0.5))",
          }}
        >
          ☀️
        </div>
        <h1
          style={{
            fontSize: 72,
            fontWeight: 800,
            background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: 0,
          }}
        >
          PB Operations Suite
        </h1>
        <p
          style={{
            fontSize: 32,
            color: "#a1a1aa",
            marginTop: 25,
          }}
        >
          Streamline your solar operations today
        </p>
        <div
          style={{
            marginTop: 50,
            transform: `scale(${buttonScale})`,
          }}
        >
          <div
            style={{
              display: "inline-block",
              background: "linear-gradient(135deg, #22c55e 0%, #16a34a 100%)",
              padding: "20px 60px",
              borderRadius: 16,
              fontSize: 28,
              fontWeight: 700,
              color: "#fff",
              boxShadow: "0 0 40px rgba(34, 197, 94, 0.4)",
            }}
          >
            pb-operations-suite.vercel.app
          </div>
        </div>
        <p
          style={{
            fontSize: 22,
            color: "#71717a",
            marginTop: 40,
          }}
        >
          Built for Photon Brothers • Powered by HubSpot
        </p>
      </div>
    </AbsoluteFill>
  );
};
