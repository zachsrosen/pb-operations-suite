import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const PipelineDashboardsDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(135deg, #0a0a0f 0%, #0f172a 100%)",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Title */}
      <Sequence from={0} durationInFrames={90}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            opacity: titleOpacity,
          }}
        >
          <h1
            style={{
              fontSize: 70,
              fontWeight: 700,
              color: "#fff",
              margin: 0,
            }}
          >
            📊 Pipeline Dashboards
          </h1>
          <p
            style={{
              fontSize: 32,
              color: "#a1a1aa",
              marginTop: 20,
            }}
          >
            Track Every Stage of Your Business
          </p>
        </AbsoluteFill>
      </Sequence>

      {/* Pipeline Cards */}
      <Sequence from={90} durationInFrames={270}>
        <AbsoluteFill style={{ padding: 60 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 40,
              height: "80%",
            }}
          >
            <PipelineCard
              title="Sales Pipeline"
              icon="💰"
              color="#22c55e"
              stages={[
                "Qualified to Buy",
                "Proposal Submitted",
                "Proposal Accepted",
                "Finalizing Deal",
                "Closed Won/Lost",
              ]}
              delay={0}
            />
            <PipelineCard
              title="D&R Pipeline"
              icon="🔧"
              color="#8b5cf6"
              stages={[
                "Kickoff",
                "Site Survey",
                "Design & Permit",
                "Detach / Reset",
                "Inspection & Closeout",
              ]}
              delay={20}
            />
            <PipelineCard
              title="Service Pipeline"
              icon="🛠️"
              color="#06b6d4"
              stages={[
                "Project Prep",
                "Site Visit Scheduling",
                "Work In Progress",
                "Inspection",
                "Invoicing",
              ]}
              delay={40}
            />
          </div>
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};

const PipelineCard: React.FC<{
  title: string;
  icon: string;
  color: string;
  stages: string[];
  delay: number;
}> = ({ title, icon, color, stages, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame: frame - delay,
    fps,
    config: { damping: 80 },
  });

  return (
    <div
      style={{
        background: "rgba(255, 255, 255, 0.03)",
        borderRadius: 20,
        padding: 40,
        border: `2px solid ${color}`,
        transform: `scale(${scale})`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 15, marginBottom: 30 }}>
        <span style={{ fontSize: 40 }}>{icon}</span>
        <h3 style={{ fontSize: 32, fontWeight: 600, color, margin: 0 }}>{title}</h3>
      </div>
      <div style={{ flex: 1 }}>
        {stages.map((stage, i) => (
          <StageRow key={i} stage={stage} index={i} total={stages.length} delay={delay + i * 5} />
        ))}
      </div>
    </div>
  );
};

const StageRow: React.FC<{
  stage: string;
  index: number;
  total: number;
  delay: number;
}> = ({ stage, index, total, delay }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 15,
        padding: "15px 0",
        borderBottom: index < total - 1 ? "1px solid rgba(255,255,255,0.1)" : "none",
        opacity,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          background: `rgba(255, 255, 255, ${0.1 + (index / total) * 0.2})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {index + 1}
      </div>
      <span style={{ fontSize: 18, color: "#d4d4d8" }}>{stage}</span>
    </div>
  );
};
