"use client";

import { useEffect, useRef, useCallback } from "react";

interface WaveformBarProps {
  peaks: number[];             // normalized 0.0–1.0 RMS values
  progress: number;            // 0.0–1.0 playback position
  loopStartPct?: number | null; // 0–100
  loopEndPct?: number | null;   // 0–100
}

export default function WaveformBar({
  peaks,
  progress,
  loopStartPct,
  loopEndPct,
}: WaveformBarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const n = peaks.length;
    const barW = w / n;
    const gap = Math.max(0.5, barW * 0.25);
    const bw = Math.max(1, barW - gap);
    const midY = h / 2;
    const progressX = progress * w;
    const maxBarH = h - 2;

    for (let i = 0; i < n; i++) {
      const x = i * barW + gap / 2;
      const barH = Math.max(2, peaks[i] * maxBarH);
      const isPlayed = x + bw <= progressX;
      ctx.fillStyle = isPlayed ? "rgb(147, 51, 234)" : "rgb(55, 65, 81)";
      ctx.fillRect(x, midY - barH / 2, bw, barH);
    }

    // Loop zone tint overlay
    if (loopStartPct != null && loopEndPct != null) {
      const lx = (loopStartPct / 100) * w;
      const lw = ((loopEndPct - loopStartPct) / 100) * w;
      ctx.fillStyle = "rgba(234, 179, 8, 0.15)";
      ctx.fillRect(lx, 0, lw, h);
    }
  }, [peaks, progress, loopStartPct, loopEndPct]);

  // Redraw when data changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Redraw on resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full rounded-full"
    />
  );
}
