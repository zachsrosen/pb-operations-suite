import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const PEDashboardDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 30], [0, 1], {
    extrapolateRight: "clamp",
  });

  const titleY = spring({
    frame,
    fps,
    config: { damping: 100 },
  });

  return (
    <AbsoluteFill
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Title */}
      <Sequence from={0} durationInFrames={60}>
        <AbsoluteFill
          style={{
            justifyContent: "center",
            alignItems: "center",
            opacity: titleOpacity,
            transform: `translateY(${(1 - titleY) * 50}px)`,
            background: "linear-gradient(135deg, #166534 0%, #064e3b 100%)",
          }}
        >
          <h1
            style={{
              fontSize: 80,
              fontWeight: 700,
              color: "#fff",
              margin: 0,
            }}
          >
            Participate Energy
          </h1>
          <p
            style={{
              fontSize: 32,
              color: "rgba(255,255,255,0.8)",
              marginTop: 20,
            }}
          >
            Project Milestone Tracker
          </p>
        </AbsoluteFill>
      </Sequence>

      {/* PE Dashboard UI */}
      <Sequence from={60} durationInFrames={180}>
        <PEDashboardMockup />
      </Sequence>
    </AbsoluteFill>
  );
};

const PEDashboardMockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const uiScale = spring({
    frame,
    fps,
    config: { damping: 80 },
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(180deg, #166534 0%, #f0fdf4 10%)",
        transform: `scale(${uiScale})`,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "#166534",
          padding: "30px 50px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: 36, color: "#fff", margin: 0, fontWeight: 700 }}>
            Participate Energy
          </h1>
          <p style={{ fontSize: 16, color: "rgba(255,255,255,0.8)", margin: "5px 0 0 0" }}>
            Project Milestone Tracker
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 48, color: "#fff", fontWeight: 700 }}>150</div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}>Active Projects</div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div
        style={{
          background: "#166534",
          padding: "0 50px 20px 50px",
          display: "flex",
          gap: 10,
        }}
      >
        <PETab label="Overview" active />
        <PETab label="Projects" />
        <PETab label="Milestones" />
      </div>

      {/* Main Content */}
      <div style={{ padding: "30px 50px" }}>
        {/* Stats Row */}
        <div style={{ display: "flex", gap: 20, marginBottom: 30 }}>
          <PEStatCard
            value="$5.67M"
            label="Total Pipeline Value"
            color="#166534"
            delay={0}
          />
          <PEStatCard
            value="24"
            label="Overdue (PTO)"
            color="#ef4444"
            delay={5}
          />
          <PEStatCard
            value="15"
            label="PTO Next 30 Days"
            color="#f59e0b"
            delay={10}
          />
          <PEStatCard
            value="110"
            label="On Track"
            color="#22c55e"
            delay={15}
          />
        </div>

        {/* Forecast Cards */}
        <div style={{ display: "flex", gap: 20, marginBottom: 30 }}>
          <ForecastCard
            title="Forecasted Installation"
            color="#3b82f6"
            overdue={52}
            next14d={11}
            onTrack={82}
            delay={0}
          />
          <ForecastCard
            title="Forecasted Inspection"
            color="#f59e0b"
            overdue={37}
            next14d={8}
            onTrack={103}
            delay={10}
          />
          <ForecastCard
            title="Forecasted PTO"
            color="#22c55e"
            overdue={24}
            next14d={15}
            onTrack={110}
            delay={20}
          />
        </div>

        {/* Chart Section */}
        <div
          style={{
            background: "#fff",
            borderRadius: 12,
            padding: 25,
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}
        >
          <h3 style={{ fontSize: 18, color: "#1f2937", margin: "0 0 20px 0", fontWeight: 600 }}>
            6-Month Milestone Forecast
          </h3>
          <MilestoneChart />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const PETab: React.FC<{ label: string; active?: boolean }> = ({ label, active }) => (
  <div
    style={{
      padding: "10px 24px",
      borderRadius: 8,
      background: active ? "rgba(255,255,255,0.2)" : "transparent",
      color: "#fff",
      fontSize: 15,
      fontWeight: 500,
    }}
  >
    {label}
  </div>
);

const PEStatCard: React.FC<{
  value: string;
  label: string;
  color: string;
  delay: number;
}> = ({ value, label, color, delay }) => {
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
        flex: 1,
        background: "#fff",
        borderRadius: 12,
        padding: 20,
        borderLeft: `4px solid ${color}`,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        transform: `scale(${scale})`,
      }}
    >
      <div style={{ fontSize: 36, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 14, color: "#6b7280", marginTop: 5 }}>{label}</div>
    </div>
  );
};

const ForecastCard: React.FC<{
  title: string;
  color: string;
  overdue: number;
  next14d: number;
  onTrack: number;
  delay: number;
}> = ({ title, color, overdue, next14d, onTrack, delay }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        flex: 1,
        background: "#fff",
        borderRadius: 12,
        padding: 20,
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        opacity,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 15 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: color,
          }}
        />
        <h4 style={{ fontSize: 16, color: "#1f2937", margin: 0, fontWeight: 600 }}>
          {title}
        </h4>
      </div>
      <ForecastRow label="Overdue:" value={overdue} color="#ef4444" />
      <ForecastRow label="Next 14d:" value={next14d} color="#f59e0b" />
      <ForecastRow label="On Track:" value={onTrack} color="#22c55e" />
    </div>
  );
};

const ForecastRow: React.FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "8px 0",
      borderBottom: "1px solid #f3f4f6",
    }}
  >
    <span style={{ fontSize: 14, color }}>{label}</span>
    <span style={{ fontSize: 14, color: "#1f2937", fontWeight: 600 }}>{value}</span>
  </div>
);

const MilestoneChart: React.FC = () => {
  const frame = useCurrentFrame();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  const installData = [45, 52, 48, 55, 60, 58];
  const inspectionData = [40, 48, 45, 50, 55, 52];
  const ptoData = [35, 42, 40, 45, 50, 48];

  const maxValue = 70;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 30, height: 200 }}>
      {months.map((month, i) => {
        const barDelay = i * 5;
        const barScale = interpolate(frame - barDelay - 30, [0, 15], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        return (
          <div
            key={month}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 4,
                alignItems: "flex-end",
                height: 160,
              }}
            >
              <div
                style={{
                  width: 16,
                  height: `${(installData[i] / maxValue) * 160 * barScale}px`,
                  background: "#3b82f6",
                  borderRadius: 4,
                }}
              />
              <div
                style={{
                  width: 16,
                  height: `${(inspectionData[i] / maxValue) * 160 * barScale}px`,
                  background: "#f59e0b",
                  borderRadius: 4,
                }}
              />
              <div
                style={{
                  width: 16,
                  height: `${(ptoData[i] / maxValue) * 160 * barScale}px`,
                  background: "#22c55e",
                  borderRadius: 4,
                }}
              />
            </div>
            <span style={{ fontSize: 12, color: "#6b7280" }}>{month}</span>
          </div>
        );
      })}
    </div>
  );
};
