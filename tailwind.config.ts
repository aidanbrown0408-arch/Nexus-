import type { Config } from "tailwindcss";

// Design tokens lifted from the Nexus design canvas (Nexus.dc.html).
//
// The app was written against Tailwind's stock `neutral` and `indigo`
// scales, so rather than rewriting several thousand class names we
// redefine those two scales in terms of the design's palette. Every
// existing `text-neutral-500` / `bg-indigo-600` in the codebase picks up
// the new look for free, and the semantic aliases below (`canvas`,
// `ink`, `line`, `accent`) are what new code should reach for.
const stone = {
  50: "#FBFAF8",  // surface, soft
  100: "#F4F2EC", // surface, muted
  200: "#E4E1DA", // hairline
  300: "#DDD9D1", // hairline, stronger
  400: "#B0ABA2", // text, faintest
  500: "#9A968E", // text, tertiary
  600: "#6B6862", // text, secondary
  700: "#57544E", // text, body
  800: "#2E2C27", // ink, hover
  900: "#1B1A17", // ink
  950: "#12110F",
};

// oklch(0.52 0.09 205) and its neighbours, resolved to sRGB.
const teal = {
  50: "#EEF9FB",
  100: "#D5F1F5",
  200: "#B9E4E9",
  300: "#96D0D7",
  400: "#56A7B0",
  500: "#238994",
  600: "#007781",
  700: "#00606A",
  800: "#004A52",
  900: "#00363C",
  950: "#002024",
};

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        neutral: stone,
        indigo: teal,
        stone,
        accent: teal,
        canvas: "#F6F5F2",
        surface: {
          DEFAULT: "#FFFFFF",
          soft: "#FBFAF8",
          muted: "#F1EFEA",
          sunken: "#F4F2EC",
        },
        line: {
          DEFAULT: "#E4E1DA",
          soft: "#EEEBE4",
          strong: "#DDD9D1",
        },
        ink: {
          DEFAULT: "#1B1A17",
          soft: "#2E2C27",
          body: "#57544E",
          muted: "#6B6862",
          faint: "#8E8A82",
          ghost: "#9A968E",
          wisp: "#B0ABA2",
        },
        danger: "#B4402F",
      },
      fontFamily: {
        // Wired up in app/layout.tsx via next/font.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["60px", { lineHeight: "1.04", letterSpacing: "-0.03em" }],
      },
      letterSpacing: {
        label: "0.14em",
        eyebrow: "0.1em",
        chip: "0.06em",
      },
      borderRadius: {
        panel: "20px",
        card: "16px",
        well: "18px",
      },
      boxShadow: {
        tab: "0 1px 2px rgba(27,26,23,.08)",
        raised: "0 1px 2px rgba(27,26,23,.06)",
      },
      keyframes: {
        breathe: {
          "0%,100%": { transform: "scale(1)", opacity: "0.5" },
          "50%": { transform: "scale(1.06)", opacity: "0.9" },
        },
      },
      animation: {
        breathe: "breathe 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
