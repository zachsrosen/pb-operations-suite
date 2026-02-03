import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const CommandCenterDemo: React.FC = () => {
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
        background: "linear-gradient(135deg, #0a0a0f 0%, #1e1b4b 100%)",
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
          }}
        >
          <h1
            style={{
              fontSize: 80,
              fontWeight: 700,
              color: "#8b5cf6",
              margin: 0,
              textShadow: "0 0 40px rgba(139, 92, 246, 0.5)",
            }}
          >
            PB Command Center
          </h1>
          <p
            style={{
              fontSize: 32,
              color: "#a1a1aa",
              marginTop: 20,
            }}
          >
            Unified Pipeline & Scheduling System
          </p>
        </AbsoluteFill>
      </Sequence>

      {/* Command Center UI */}
      <Sequence from={60} durationInFrames={240}>
        <CommandCenterMockup />
      </Sequence>
    </AbsoluteFill>
  );
};

const CommandCenterMockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const uiScale = spring({
    frame,
    fps,
    config: { damping: 80 },
  });

  // Tab switching animation
  const activeTab = frame < 80 ? 0 : frame < 140 ? 1 : frame < 200 ? 2 : 3;

  return (
    <AbsoluteFill
      style={{
        padding: 40,
        transform: `scale(${uiScale})`,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 30,
        }}
      >
        <div>
          <h2 style={{ fontSize: 32, color: "#fff", margin: 0 }}>
            PB Command Center
          </h2>
          <p style={{ fontSize: 14, color: "#71717a", margin: "5px 0 0 0" }}>
            Unified Pipeline & Scheduling System - Live Data
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: 12, color: "#71717a", margin: 0 }}>
            Updated: 1/23/2026, 1:17:02 AM
          </p>
          <p style={{ fontSize: 14, color: "#22c55e", margin: "5px 0 0 0" }}>
            Pipeline: $29.09M
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        <NavTab label="Pipeline Overview" active={activeTab === 0} color="#f97316" />
        <NavTab label="Revenue" active={activeTab === 1} color="#f97316" />
        <NavTab label="Capacity Planning" active={false} />
        <NavTab label="Scheduler" active={false} arrow />
        <NavTab label="Participate Energy" active={activeTab === 2} badge={150} color="#06b6d4" />
        <NavTab label="Alerts" active={activeTab === 3} badge={108} color="#ef4444" />
      </div>

      {/* Stats Cards */}
      <div style={{ display: "flex", gap: 20, marginBottom: 30 }}>
        <StatCard value="715" label="Total Projects" subtext="$29.1M pipeline" color="#fff" borderColor="#3f3f46" />
        <StatCard value="68" label="Ready to Build" subtext="Available to schedule" color="#22c55e" borderColor="#22c55e" />
        <StatCard value="150" label="Participate Energy" subtext="Milestone tracking" color="#06b6d4" borderColor="#06b6d4" />
        <StatCard value="94" label="Install Overdue" subtext="Past forecast date" color="#f59e0b" borderColor="#f59e0b" />
        <StatCard value="156" label="Inspection Overdue" color="#ef4444" borderColor="#ef4444" />
        <StatCard value="236" label="PTO Overdue" color="#ef4444" borderColor="#ef4444" />
      </div>

      {/* Filter Row */}
      <div style={{ display: "flex", gap: 15, marginBottom: 20, alignItems: "center" }}>
        <span style={{ color: "#71717a", fontSize: 14 }}>Location:</span>
        <FilterPill label="All Locations" active />
        <span style={{ color: "#71717a", fontSize: 14, marginLeft: 20 }}>Type:</span>
        <FilterPill label="All" active color="#06b6d4" />
        <FilterPill label="PE Only" />
        <FilterPill label="Non-PE" />
        <span style={{ color: "#71717a", fontSize: 14, marginLeft: 20 }}>Status:</span>
        <FilterPill label="All" active color="#ef4444" />
        <FilterPill label="Overdue" />
        <FilterPill label="RTB" />
      </div>

      {/* Data Table */}
      <div
        style={{
          background: "rgba(0,0,0,0.3)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <TableHeader />
        <TableRow
          rank={1}
          project="PROJ-1157"
          stage="Close Out"
          location="San Luis Obispo"
          ahj="San Luis Obispo County"
          value="$26k"
          install="Done"
          inspection="Done"
          pto="Done"
          priority={950}
          delay={0}
        />
        <TableRow
          rank={2}
          project="PROJ-4372"
          stage="Close Out"
          location="Centennial"
          ahj="Arapahoe County"
          value="$33k"
          install="Done"
          inspection="Done"
          pto="Done"
          priority={950}
          delay={5}
        />
        <TableRow
          rank={3}
          project="PROJ-4881"
          stage="Close Out"
          location="San Luis Obispo"
          ahj="Atascadero"
          value="$45k"
          install="Done"
          inspection="Done"
          pto="Done"
          priority={950}
          delay={10}
        />
        <TableRow
          rank={4}
          project="PROJ-5122"
          stage="Close Out"
          location="San Luis Obispo"
          ahj="San Luis Obispo"
          value="$33k"
          install="Done"
          inspection="Done"
          pto="Done"
          priority={950}
          delay={15}
        />
        <TableRow
          rank={5}
          project="PROJ-5146"
          stage="Close Out"
          location="San Luis Obispo"
          ahj="Santa Rosa"
          value="$19k"
          install="Done"
          inspection="Done"
          pto="Done"
          priority={950}
          delay={20}
        />
      </div>
    </AbsoluteFill>
  );
};

const NavTab: React.FC<{
  label: string;
  active?: boolean;
  badge?: number;
  color?: string;
  arrow?: boolean;
}> = ({ label, active, badge, color, arrow }) => (
  <div
    style={{
      padding: "10px 20px",
      borderRadius: 8,
      background: active ? (color || "#f97316") : "rgba(255,255,255,0.05)",
      color: active ? "#fff" : "#a1a1aa",
      fontSize: 14,
      fontWeight: 500,
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}
  >
    {label}
    {arrow && <span style={{ opacity: 0.7 }}>→</span>}
    {badge !== undefined && (
      <span
        style={{
          background: active ? "rgba(255,255,255,0.3)" : color || "#71717a",
          padding: "2px 8px",
          borderRadius: 10,
          fontSize: 12,
        }}
      >
        {badge}
      </span>
    )}
  </div>
);

const StatCard: React.FC<{
  value: string;
  label: string;
  subtext?: string;
  color: string;
  borderColor: string;
}> = ({ value, label, subtext, color, borderColor }) => {
  const frame = useCurrentFrame();
  const scale = spring({
    frame: frame - 10,
    fps: 30,
    config: { damping: 80 },
  });

  return (
    <div
      style={{
        flex: 1,
        padding: 20,
        borderRadius: 12,
        background: "rgba(0,0,0,0.3)",
        borderLeft: `4px solid ${borderColor}`,
        transform: `scale(${scale})`,
      }}
    >
      <div style={{ fontSize: 48, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 14, color: "#a1a1aa", marginTop: 5 }}>{label}</div>
      {subtext && (
        <div style={{ fontSize: 12, color: "#71717a", marginTop: 3 }}>{subtext}</div>
      )}
    </div>
  );
};

const FilterPill: React.FC<{
  label: string;
  active?: boolean;
  color?: string;
}> = ({ label, active, color }) => (
  <div
    style={{
      padding: "6px 16px",
      borderRadius: 6,
      background: active ? (color || "#3f3f46") : "transparent",
      border: `1px solid ${active ? (color || "#3f3f46") : "#3f3f46"}`,
      color: active ? "#fff" : "#a1a1aa",
      fontSize: 13,
    }}
  >
    {label}
  </div>
);

const TableHeader: React.FC = () => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: "40px 120px 200px 100px 100px 100px 100px 100px 100px",
      padding: "15px 20px",
      borderBottom: "1px solid rgba(255,255,255,0.1)",
      fontSize: 13,
      color: "#71717a",
    }}
  >
    <span>#</span>
    <span>Project</span>
    <span>Location / AHJ</span>
    <span>Value</span>
    <span>Install</span>
    <span>Inspection</span>
    <span>PTO</span>
    <span>Priority</span>
    <span>Actions</span>
  </div>
);

const TableRow: React.FC<{
  rank: number;
  project: string;
  stage: string;
  location: string;
  ahj: string;
  value: string;
  install: string;
  inspection: string;
  pto: string;
  priority: number;
  delay: number;
}> = ({ rank, project, stage, location, ahj, value, install, inspection, pto, priority, delay }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "40px 120px 200px 100px 100px 100px 100px 100px 100px",
        padding: "15px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        fontSize: 14,
        opacity,
        alignItems: "center",
      }}
    >
      <span style={{ color: "#71717a" }}>{rank}</span>
      <div>
        <span style={{ color: "#06b6d4" }}>{project}</span>
        <div style={{ fontSize: 11, color: "#71717a" }}>{stage}</div>
      </div>
      <div>
        <span style={{ color: "#fff" }}>{location}</span>
        <div style={{ fontSize: 11, color: "#71717a" }}>{ahj}</div>
      </div>
      <span style={{ color: "#22c55e" }}>{value}</span>
      <StatusBadge status={install} />
      <StatusBadge status={inspection} />
      <StatusBadge status={pto} />
      <div style={{ position: "relative", height: 8, background: "#3f3f46", borderRadius: 4 }}>
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${(priority / 1000) * 100}%`,
            background: "#ef4444",
            borderRadius: 4,
          }}
        />
      </div>
      <span style={{ color: "#71717a" }}>...</span>
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const color = status === "Done" ? "#22c55e" : status.includes("over") ? "#ef4444" : "#f59e0b";
  return (
    <span
      style={{
        color,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {status}
    </span>
  );
};
