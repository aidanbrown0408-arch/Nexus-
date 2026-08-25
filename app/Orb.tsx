"use client";

import { useMemo } from "react";

export type OrbMode = "idle" | "listening" | "thinking" | "speaking";

// The orb from the design canvas: a slow breathing halo with a row of
// bars across it. The design drives the bars from a requestAnimationFrame
// loop; here they're CSS animations with a per-bar delay and a
// sine-shaped envelope, which reads the same and costs nothing when the
// tab is in the background.
const TUNING: Record<OrbMode, { amp: number; speed: string; label: string }> = {
  idle: { amp: 0.35, speed: "3.6s", label: "Ready" },
  listening: { amp: 0.6, speed: "1.6s", label: "Listening" },
  thinking: { amp: 0.45, speed: "2.2s", label: "Thinking" },
  speaking: { amp: 1, speed: "0.9s", label: "Speaking" },
};

export default function Orb({
  mode = "idle",
  size = 168,
  bars = 27,
}: {
  mode?: OrbMode;
  size?: number;
  bars?: number;
}) {
  const { amp, speed } = TUNING[mode];

  // Envelope: tall in the middle, short at the edges — Math.sin(pi*u)
  // raised slightly, matching the design's `Math.pow(sin, 0.75)`.
  const heights = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const u = bars === 1 ? 0.5 : i / (bars - 1);
        return Math.pow(Math.sin(Math.PI * u), 0.75);
      }),
    [bars],
  );

  return (
    <div
      className="nx-orb"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Assistant ${mode}`}
    >
      <div
        className="relative flex items-center justify-center gap-[4px]"
        style={{ height: size * 0.34, width: size * 0.62 }}
      >
        {heights.map((env, i) => (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full bg-accent-700"
            style={{
              height: `${8 + env * 92 * amp}%`,
              animation: `breathe ${speed} ease-in-out ${i * 0.045}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
