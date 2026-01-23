import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Demo component for Master Scheduler
export const MasterSchedulerDemo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Animation values
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
        background: "linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* Title Sequence */}
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
              color: "#22c55e",
              margin: 0,
              textShadow: "0 0 40px rgba(34, 197, 94, 0.5)",
            }}
          >
            PB Master Scheduler
          </h1>
          <p
            style={{
              fontSize: 32,
              color: "#a1a1aa",
              marginTop: 20,
            }}
          >
            Intelligent Install Scheduling for Solar Projects
          </p>
        </AbsoluteFill>
      </Sequence>

      {/* Scheduler UI Demo */}
      <Sequence from={60} durationInFrames={240}>
        <SchedulerMockup />
      </Sequence>
    </AbsoluteFill>
  );
};

// Mockup of the scheduler UI
const SchedulerMockup: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const uiScale = spring({
    frame,
    fps,
    config: { damping: 80 },
  });

  const highlightOpacity = interpolate(frame, [60, 90, 120, 150], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
        <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
          <span style={{ fontSize: 36, color: "#f59e0b" }}>⚡</span>
          <h2 style={{ fontSize: 32, color: "#fff", margin: 0 }}>
            PB Master Scheduler
          </h2>
          <span
            style={{
              fontSize: 14,
              color: "#71717a",
              background: "rgba(255,255,255,0.1)",
              padding: "4px 12px",
              borderRadius: 20,
            }}
          >
            RTB + Construction
          </span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <TabButton label="Month" active={false} />
          <TabButton label="Week" active={false} />
          <TabButton label="Gantt" active={true} />
        </div>
        <AutoOptimizeButton />
      </div>

      {/* Location Tabs */}
      <div style={{ display: "flex", gap: 15, marginBottom: 30 }}>
        <LocationPill label="All 234" value="$9823K" active color="#f97316" />
        <LocationPill label="Westminster 65" value="$2529K" color="#22c55e" />
        <LocationPill label="Centennial 57" value="$3183K" color="#8b5cf6" />
        <LocationPill label="Colorado Springs 12" value="$684K" color="#06b6d4" />
        <LocationPill label="San Luis Obispo 68" value="$2329K" color="#ec4899" />
        <LocationPill label="Camarillo 38" value="$1119K" color="#f59e0b" />
      </div>

      {/* Stats Row */}
      <div style={{ display: "flex", gap: 20, marginBottom: 30 }}>
        <StatBadge label="SURVEY" count={45} color="#71717a" />
        <StatBadge label="RTB" count={18} color="#22c55e" />
        <StatBadge label="BUILDING" count={17} color="#3b82f6" />
        <StatBadge label="INSPECT" count={104} color="#f59e0b" />
        <StatBadge label="PIPELINE" value="$9823K" color="#8b5cf6" />
      </div>

      {/* Gantt Chart Area */}
      <div
        style={{
          display: "flex",
          gap: 20,
          flex: 1,
        }}
      >
        {/* Project List Sidebar */}
        <div
          style={{
            width: 280,
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
            padding: 15,
          }}
        >
          <h3 style={{ fontSize: 14, color: "#71717a", margin: "0 0 15px 0" }}>
            234 projects
          </h3>
          <ProjectCard
            name="Arrow HQ, Quinn Keenan"
            value="$887.4K"
            status="blocked"
            delay={0}
          />
          <ProjectCard
            name="American Water Works..."
            value="$299.5K"
            status="construction"
            delay={10}
          />
          <ProjectCard
            name="ECOVEST INVESTMENTS..."
            value="$250.0K"
            status="inspection"
            delay={20}
          />
          <ProjectCard
            name="Turnbull, Chris"
            value="$172.0K"
            status="inspection"
            delay={30}
          />
        </div>

        {/* Gantt Timeline */}
        <div
          style={{
            flex: 1,
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
            padding: 20,
            position: "relative",
          }}
        >
          <GanttHeader />
          <GanttCrewRow
            crew="WESTY Alpha"
            projects={[
              { name: "Baran", day: 0, days: 1, color: "#8b5cf6" },
              { name: "SKYE", day: 4, days: 1, color: "#06b6d4" },
              { name: "Dripps", day: 5, days: 1, color: "#22c55e" },
              { name: "Merrick", day: 6, days: 2, color: "#f59e0b" },
            ]}
            delay={0}
          />
          <GanttCrewRow
            crew="WESTY Bravo"
            projects={[]}
            delay={10}
          />
          <GanttCrewRow
            crew="DTC Alpha"
            projects={[
              { name: "Colwell", day: 0, days: 1, color: "#f59e0b" },
              { name: "Kalter", day: 1, days: 1, color: "#f59e0b" },
              { name: "Neal", day: 4, days: 1, color: "#22c55e" },
              { name: "Lenick", day: 5, days: 1, color: "#22c55e" },
              { name: "Turner", day: 6, days: 1, color: "#8b5cf6" },
            ]}
            delay={20}
          />
          <GanttCrewRow
            crew="SLO Solar"
            projects={[
              { name: "Henry", day: 0, days: 1, color: "#06b6d4" },
              { name: "Gors", day: 1, days: 2, color: "#f59e0b" },
              { name: "Eckert", day: 5, days: 1, color: "#22c55e" },
              { name: "Strong", day: 6, days: 1, color: "#8b5cf6" },
            ]}
            delay={30}
          />

          {/* Highlight Animation - Conflict */}
          <div
            style={{
              position: "absolute",
              top: 160,
              right: 100,
              background: "rgba(239, 68, 68, 0.3)",
              border: "2px solid #ef4444",
              borderRadius: 8,
              padding: "8px 12px",
              opacity: highlightOpacity,
            }}
          >
            <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600 }}>
              Conflict Detected
            </span>
          </div>
        </div>

        {/* Right Sidebar */}
        <div
          style={{
            width: 260,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Crew Capacity */}
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 12,
              padding: 15,
            }}
          >
            <h3 style={{ fontSize: 14, color: "#f59e0b", margin: "0 0 10px 0" }}>
              Crew Capacity
            </h3>
            <p style={{ fontSize: 12, color: "#71717a", margin: 0 }}>
              Select a location to view crews
            </p>
          </div>

          {/* Conflicts */}
          <div
            style={{
              background: "rgba(0,0,0,0.3)",
              borderRadius: 12,
              padding: 15,
              flex: 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 15 }}>
              <span style={{ color: "#f59e0b" }}>Conflicts</span>
              <span
                style={{
                  background: "#f59e0b",
                  color: "#000",
                  fontSize: 12,
                  padding: "2px 8px",
                  borderRadius: 10,
                  fontWeight: 600,
                }}
              >
                25
              </span>
            </div>
            <ConflictItem project="SLO Solar - Jan 15" crew="Ammon, Thomas, Gors" delay={0} />
            <ConflictItem project="SLO Solar - Jan 28" crew="Kasai, Scott, Manpearl" delay={10} />
            <ConflictItem project="SLO Solar - Jan 23" crew="Buck-Macleod, Ian, Strong" delay={20} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

const TabButton: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <div
    style={{
      padding: "8px 20px",
      borderRadius: 8,
      background: active ? "#22c55e" : "rgba(255,255,255,0.1)",
      color: active ? "#000" : "#fff",
      fontSize: 14,
      fontWeight: 500,
    }}
  >
    {label}
  </div>
);

const AutoOptimizeButton: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = Math.sin(frame * 0.1) * 0.1 + 1;

  return (
    <div
      style={{
        padding: "12px 24px",
        borderRadius: 8,
        background: "linear-gradient(135deg, #8b5cf6, #06b6d4)",
        color: "#fff",
        fontSize: 14,
        fontWeight: 600,
        transform: `scale(${pulse})`,
        boxShadow: "0 0 20px rgba(139, 92, 246, 0.5)",
      }}
    >
      Optimize Schedule
    </div>
  );
};

const LocationPill: React.FC<{
  label: string;
  value: string;
  color: string;
  active?: boolean;
}> = ({ label, value, color, active }) => (
  <div
    style={{
      padding: "8px 16px",
      borderRadius: 8,
      background: active ? color : "rgba(255,255,255,0.05)",
      border: `1px solid ${active ? color : "rgba(255,255,255,0.1)"}`,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
    }}
  >
    <span style={{ fontSize: 12, color: active ? "#fff" : "#a1a1aa" }}>{label}</span>
    <span style={{ fontSize: 11, color: active ? "rgba(255,255,255,0.8)" : "#71717a" }}>
      {value}
    </span>
  </div>
);

const StatBadge: React.FC<{
  label: string;
  count?: number;
  value?: string;
  color: string;
}> = ({ label, count, value, color }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <div
      style={{
        width: 12,
        height: 12,
        borderRadius: 4,
        background: color,
      }}
    />
    <span style={{ fontSize: 14, color: "#a1a1aa" }}>
      {count !== undefined ? count : ""} {label}
    </span>
    {value && (
      <span style={{ fontSize: 14, color, fontWeight: 600 }}>{value}</span>
    )}
  </div>
);

const ProjectCard: React.FC<{
  name: string;
  value: string;
  status: string;
  delay: number;
}> = ({ name, value, status, delay }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const statusColors: Record<string, string> = {
    blocked: "#f59e0b",
    construction: "#3b82f6",
    inspection: "#8b5cf6",
  };

  return (
    <div
      style={{
        padding: 12,
        background: "rgba(255,255,255,0.03)",
        borderRadius: 8,
        marginBottom: 10,
        borderLeft: `3px solid ${statusColors[status]}`,
        opacity,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, color: "#22c55e", fontWeight: 500 }}>
          {name}
        </span>
        <span style={{ fontSize: 13, color: "#22c55e" }}>{value}</span>
      </div>
      <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>
        {status}
      </div>
    </div>
  );
};

const GanttHeader: React.FC = () => {
  const days = ["Tue 13", "Wed 14", "Thu 15", "Fri 16", "Mon 19", "Tue 20", "Wed 21"];
  return (
    <div
      style={{
        display: "flex",
        borderBottom: "1px solid rgba(255,255,255,0.1)",
        paddingBottom: 10,
        marginBottom: 10,
        paddingLeft: 120,
      }}
    >
      {days.map((day, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            fontSize: 12,
            color: "#71717a",
            textAlign: "center",
          }}
        >
          {day}
        </div>
      ))}
    </div>
  );
};

const GanttCrewRow: React.FC<{
  crew: string;
  projects: Array<{ name: string; day: number; days: number; color: string }>;
  delay: number;
}> = ({ crew, projects, delay }) => {
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
        height: 50,
        opacity,
      }}
    >
      <div style={{ width: 120, fontSize: 13, color: "#a1a1aa" }}>{crew}</div>
      <div style={{ flex: 1, display: "flex", position: "relative", height: 36 }}>
        {projects.map((project, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(project.day / 7) * 100}%`,
              width: `${(project.days / 7) * 100}%`,
              height: 32,
              background: project.color,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              color: "#fff",
              fontWeight: 500,
            }}
          >
            {project.name}
          </div>
        ))}
      </div>
    </div>
  );
};

const ConflictItem: React.FC<{ project: string; crew: string; delay: number }> = ({
  project,
  crew,
  delay,
}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame - delay - 30, [0, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        padding: 10,
        background: "rgba(245, 158, 11, 0.1)",
        borderRadius: 8,
        marginBottom: 8,
        borderLeft: "3px solid #f59e0b",
        opacity,
      }}
    >
      <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 500 }}>
        {project}
      </div>
      <div style={{ fontSize: 11, color: "#71717a", marginTop: 4 }}>{crew}</div>
    </div>
  );
};
