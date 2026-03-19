"use client";

import { useEffect, useRef, useState } from "react";
import type { RevenueGroupResult } from "@/lib/revenue-groups-config";

interface Props {
  groups: RevenueGroupResult[];
  year: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

export function RevenueGoalFireworks({ groups, year }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    const month = new Date().getMonth() + 1;
    const unfired = groups.filter((g) => {
      const key = `fireworks:${g.groupKey}:${year}-${month}`;
      return !sessionStorage.getItem(key);
    });

    if (unfired.length === 0) return;

    for (const g of unfired) {
      const key = `fireworks:${g.groupKey}:${year}-${month}`;
      sessionStorage.setItem(key, "1");
    }

    setShouldAnimate(true);
  }, [groups, year]);

  useEffect(() => {
    if (!shouldAnimate || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const particles: Particle[] = [];
    const colors = groups.map((g) => g.color);

    for (let i = 0; i < 80; i++) {
      const angle = (Math.PI * 2 * i) / 80 + Math.random() * 0.3;
      const speed = 2 + Math.random() * 4;
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        life: 0,
        maxLife: 60 + Math.random() * 40,
        size: 2 + Math.random() * 3,
      });
    }

    let frame = 0;
    const maxFrames = 120;

    function animate() {
      if (frame >= maxFrames || !ctx) {
        setShouldAnimate(false);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.05;
        p.life++;

        const alpha = Math.max(0, 1 - p.life / p.maxLife);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      frame++;
      requestAnimationFrame(animate);
    }

    animate();
  }, [shouldAnimate, groups]);

  if (!shouldAnimate) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
