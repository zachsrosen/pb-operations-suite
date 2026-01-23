import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const FullSuiteDemo: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: "#0a0a0f",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Intro */}
      <Sequence from={0} durationInFrames={90}>
        <IntroScene />
      </Sequence>

      {/* Tools Showcase */}
      <Sequence from={90} durationInFrames={150}>
        <ToolsShowcase />
      </Sequence>

      {/* Features Grid */}
      <Sequence from={240} durationInFrames={150}>
        <FeaturesScene />
      </Sequence>

      {/* Stats */}
      <Sequence from={390} durationInFrames={120}>
        <StatsScene />
      </Sequence>

      {/* Outro */}
      <Sequence from={510} durationInFrames={90}>
        <OutroScene />
      </Sequence>
    </AbsoluteFill>
  );
};

const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 50 },
  });

  const titleOpacity = interpolate(frame, [20, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [40, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(circle at center, #1a1a2e 0%, #0a0a0f 100%)",
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${logoScale})` }}>
        <div
          style={{
            fontSize: 100,
            marginBottom: 20,
          }}
        >
          ☀️
        </div>
        <h1
          style={{
            fontSize: 80,
            fontWeight: 800,
            background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: 0,
            opacity: titleOpacity,
          }}
        >
          PB Operations Suite
        </h1>
        <p
          style={{
            fontSize: 32,
            color: "#71717a",
            marginTop: 25,
            opacity: subtitleOpacity,
          }}
        >
          Solar Operations Management • Photon Brothers
        </p>
      </div>
    </AbsoluteFill>
  );
};

const ToolsShowcase: React.FC = () => {
  const frame = useCurrentFrame();

  const tools = [
    {
      name: "Master Scheduler",
      icon: "📅",
      color: "#22c55e",
      description: "Intelligent crew scheduling with conflict detection"
    },
    {
      name: "Command Center",
      icon: "🎯",
      color: "#8b5cf6",
      description: "Unified pipeline & operations dashboard"
    },
    {
      name: "PE Dashboard",
      icon: "⚡",
      color: "#f59e0b",
      description: "Participate Energy milestone tracking"
    },
    {
      name: "Pipeline Analytics",
      icon: "📊",
      color: "#06b6d4",
      description: "Executive summaries & location insights"
    },
  ];

  return (
    <AbsoluteFill style={{ padding: 60 }}>
      <h2
        style={{
          fontSize: 52,
          color: "#fff",
          marginBottom: 50,
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        Complete Operations Toolkit
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 30,
          flex: 1,
        }}
      >
        {tools.map((tool, i) => {
          const delay = i * 15;
          const scale = spring({
            frame: frame - delay,
            fps: 30,
            config: { damping: 80 },
          });
          return (
            <div
              key={i}
              style={{
                background: `${tool.color}10`,
                border: `2px solid ${tool.color}`,
                borderRadius: 20,
                padding: 35,
                display: "flex",
                alignItems: "center",
                gap: 25,
                transform: `scale(${scale})`,
              }}
            >
              <span style={{ fontSize: 60 }}>{tool.icon}</span>
              <div>
                <h3 style={{ fontSize: 28, color: tool.color, margin: 0, fontWeight: 600 }}>
                  {tool.name}
                </h3>
                <p style={{ fontSize: 18, color: "#a1a1aa", margin: "10px 0 0 0" }}>
                  {tool.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const FeaturesScene: React.FC = () => {
  const frame = useCurrentFrame();

  const features = [
    { text: "Live HubSpot Integration", icon: "🔗" },
    { text: "Real-time Data Sync", icon: "🔄" },
    { text: "Multi-location Support", icon: "🏢" },
    { text: "Crew Scheduling", icon: "👷" },
    { text: "Revenue Tracking", icon: "💰" },
    { text: "Milestone Forecasting", icon: "📈" },
    { text: "Conflict Detection", icon: "⚠️" },
    { text: "Auto-Optimization", icon: "🤖" },
  ];

  return (
    <AbsoluteFill
      style={{
        padding: 60,
        background: "linear-gradient(180deg, #0a0a0f 0%, #1e1b4b 100%)",
      }}
    >
      <h2
        style={{
          fontSize: 52,
          color: "#fff",
          marginBottom: 50,
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        Key Capabilities
      </h2>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 20,
          justifyContent: "center",
        }}
      >
        {features.map((feature, i) => {
          const delay = i * 8;
          const opacity = interpolate(frame - delay, [0, 20], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const y = interpolate(frame - delay, [0, 20], [30, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={i}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                padding: "20px 35px",
                borderRadius: 50,
                display: "flex",
                alignItems: "center",
                gap: 12,
                opacity,
                transform: `translateY(${y}px)`,
              }}
            >
              <span style={{ fontSize: 24 }}>{feature.icon}</span>
              <span style={{ fontSize: 22, color: "#fff", fontWeight: 500 }}>
                {feature.text}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const StatsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const stats = [
    { value: "$29M", label: "Pipeline Tracked", color: "#22c55e" },
    { value: "715+", label: "Projects Managed", color: "#8b5cf6" },
    { value: "5", label: "Locations", color: "#06b6d4" },
    { value: "150+", label: "PE Projects", color: "#f59e0b" },
  ];

  return (
    <AbsoluteFill
      style={{
        padding: 60,
        justifyContent: "center",
        background: "radial-gradient(circle at center, #1a1a2e 0%, #0a0a0f 100%)",
      }}
    >
      <h2
        style={{
          fontSize: 52,
          color: "#fff",
          marginBottom: 60,
          textAlign: "center",
          fontWeight: 700,
        }}
      >
        Real Results
      </h2>
      <div style={{ display: "flex", gap: 40, justifyContent: "center" }}>
        {stats.map((stat, i) => {
          const delay = i * 12;
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
                  fontSize: 72,
                  fontWeight: 800,
                  color: stat.color,
                }}
              >
                {stat.value}
              </div>
              <div style={{ fontSize: 22, color: "#a1a1aa", marginTop: 10 }}>
                {stat.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 50 },
  });

  const urlOpacity = interpolate(frame, [30, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(circle at center, #1a1a2e 0%, #0a0a0f 100%)",
      }}
    >
      <div style={{ textAlign: "center", transform: `scale(${scale})` }}>
        <h1
          style={{
            fontSize: 70,
            fontWeight: 800,
            background: "linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            margin: 0,
          }}
        >
          Streamline Your Operations
        </h1>
        <p
          style={{
            fontSize: 28,
            color: "#a1a1aa",
            marginTop: 30,
            opacity: urlOpacity,
          }}
        >
          pb-operations-suite.vercel.app
        </p>
        <div
          style={{
            marginTop: 40,
            display: "flex",
            gap: 15,
            justifyContent: "center",
            opacity: urlOpacity,
          }}
        >
          <span style={{ fontSize: 40 }}>☀️</span>
          <span style={{ fontSize: 20, color: "#71717a", alignSelf: "center" }}>
            Photon Brothers
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
