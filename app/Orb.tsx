"use client";

import { useMemo } from "react";

export type OrbMode = "idle" | "listening" | "thinking" | "speaking";

// The orb: a pearl sphere with a waveform across it and a soft halo
// behind it that breathes.
//
// Two fixes over the first version:
// - The bars used to borrow the halo's `breathe` keyframe, which only
//   scales by 6% — so the "waveform" barely moved in any mode. They now
//   run their own `nx-wave` keyframe (a vertical squash), so speaking
//   visibly differs from idle.
// - The halo was a ::before at z-index -1, which drops behind the nearest
//   stacking context — i.e. behind the white panel it sits in, where it
//   could never be seen. It's now a real element inside an isolated
//   wrapper.
const TUNING: Record<OrbMode, { amp: number; speed: string; halo: number }> = {
  idle: { amp: 0.35, speed: "3.2s", halo: 0.55 },
  listening: { amp: 0.7, speed: "1.3s", halo: 1 },
  thinking: { amp: 0.5, speed: "1.9s", halo: 0.85 },
  speaking: { amp: 1, speed: "0.85s", halo: 1 },
};

const GAP_RATIO = 4 / 3;
const ROW_FILL = 0.86;

export default function Orb({
  mode = "idle",
  size = 168,
}: {
  mode?: OrbMode;
  size?: number;
}) {
  const { amp, speed, halo } = TUNING[mode];

  const { bars, barWidth, gap } = useMemo(() => {
    const count = Math.max(7, Math.min(27, Math.round(size / 7)));
    const rowWidth = size * 0.62 * ROW_FILL;
    const rawWidth = rowWidth / (count + (count - 1) * GAP_RATIO);
    const width = Math.max(1.5, Math.min(4, rawWidth));
    return { bars: count, barWidth: width, gap: width * GAP_RATIO };
  }, [size]);

  // Envelope: tall in the middle, short at the edges.
  const heights = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => {
        const u = bars === 1 ? 0.5 : i / (bars - 1);
        return Math.pow(Math.sin(Math.PI * u), 0.75);
      }),
    [bars]
  );

  const boxShadow = [
    `0 ${size * 0.143}px ${size * 0.357}px ${-size * 0.119}px rgba(16,24,40,0.16)`,
    `0 ${size * 0.024}px ${size * 0.083}px ${-size * 0.024}px rgba(16,24,40,0.06)`,
    `inset 0 1px 0 rgba(255,255,255,0.9)`,
    `inset 0 ${-size * 0.083}px ${size * 0.179}px ${-size * 0.107}px rgba(16,24,40,0.12)`,
  ].join(", ");

  return (
    <div
      className="relative isolate shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Assistant ${mode}`}
      data-mode={mode}
    >
      <span
        aria-hidden
        className="nx-orb-halo"
        style={{ opacity: halo, animationDuration: mode === "idle" ? "4s" : "2s" }}
      />
      <div className="nx-orb absolute inset-0" style={{ boxShadow }}>
        <div
          className="relative flex shrink-0 items-center justify-center"
          style={{ height: size * 0.34, width: size * 0.62, gap }}
        >
          {heights.map((env, i) => (
            <span
              key={i}
              className="nx-orb-bar shrink-0 rounded-full bg-accent-700"
              style={{
                width: barWidth,
                height: `${10 + env * 90 * amp}%`,
                // Staggered from the centre outwards, so the wave reads as
                // radiating from the middle rather than sweeping across.
                animation: `nx-wave ${speed} ease-in-out ${(
                  -Math.abs(i - (bars - 1) / 2) * 0.09
                ).toFixed(2)}s infinite`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
