"use client";

import { useEffect, useState } from "react";

export default function LiveClock({ className }: { className?: string }) {
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setTime(new Date());
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return null;

  return (
    <span className={className}>
      {time.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}{" "}
      · {time.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      })}
    </span>
  );
}
