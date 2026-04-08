"use client";

interface AmbientBackgroundProps {
  sectionColor: string;
}

export default function AmbientBackground({ sectionColor }: AmbientBackgroundProps) {
  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none"
      style={{ zIndex: 0 }}
    >
      <div
        className="absolute inset-0 transition-colors duration-[2000ms]"
        style={{
          background: `linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)`,
        }}
      />
      <div
        className="absolute rounded-full blur-[120px] opacity-[0.07]"
        style={{
          width: 600,
          height: 600,
          top: "-10%",
          left: "-5%",
          backgroundColor: sectionColor,
          transition: "background-color 2s ease",
          animation: "drift-1 20s ease-in-out infinite",
        }}
      />
      <div
        className="absolute rounded-full blur-[100px] opacity-[0.05]"
        style={{
          width: 450,
          height: 450,
          bottom: "-8%",
          right: "-3%",
          backgroundColor: sectionColor,
          transition: "background-color 2s ease",
          animation: "drift-2 25s ease-in-out infinite",
        }}
      />
      <div
        className="absolute rounded-full blur-[80px] opacity-[0.04]"
        style={{
          width: 300,
          height: 300,
          top: "40%",
          right: "15%",
          backgroundColor: sectionColor,
          transition: "background-color 2s ease",
          animation: "drift-3 18s ease-in-out infinite",
        }}
      />
    </div>
  );
}
