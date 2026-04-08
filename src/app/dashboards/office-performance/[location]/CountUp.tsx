"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function CountUp({
  value,
  duration = 800,
  decimals = 0,
  suffix = "",
  className,
  style,
}: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const prevValue = useRef(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = prevValue.current;
    const end = value;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      setDisplay(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevValue.current = end;
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  const formatted = decimals > 0
    ? display.toFixed(decimals)
    : Math.round(display).toString();

  return (
    <span className={className} style={style}>
      {formatted}{suffix}
    </span>
  );
}
