import type { Config } from "tailwindcss";

// Design tokens.
//
// The app was written against Tailwind's stock `neutral` and `indigo`
// scales, so rather than rewriting several thousand class names we
// redefine those two scales here. Every existing `text-neutral-500` /
// `bg-indigo-600` picks up the palette for free, and the semantic
// aliases below (`canvas`, `ink`, `line`, `accent`) are what new code
// should reach for.
//
// Palette: cool, slightly blue-tinted grays and a confident blue accent —
// a crisp, corporate look.
const gray = {
  50: "#F9FAFB",  // surface, soft
  100: "#F2F4F7", // surface, muted
  200: "#EAECF0", // hairline
  300: "#D0D5DD", // hairline, stronger
  400: "#98A2B3", // text, faintest
  500: "#667085", // text, tertiary
  600: "#475467", // text, secondary
  700: "#344054", // text, body
  800: "#1D2939", // ink, hover
  900: "#101828", // ink
  950: "#0C111D",
};

const blue = {
  50: "#EFF4FF",
  100: "#D1E0FF",
  200: "#B2CCFF",
  300: "#84ADFF",
  400: "#528BFF",
  500: "#2970FF",
  600: "#155EEF",
  700: "#004EEB",
  800: "#0040C1",
  900: "#00359E",
  950: "#002266",
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
        neutral: gray,
        indigo: blue,
        stone: gray,
        accent: blue,
        canvas: "#F5F7FA",
        surface: {
          DEFAULT: "#FFFFFF",
          soft: "#F9FAFB",
          muted: "#F2F4F7",
          sunken: "#F2F4F7",
        },
        line: {
          DEFAULT: "#E4E7EC",
          soft: "#EEF0F3",
          strong: "#D0D5DD",
        },
        ink: {
          DEFAULT: "#101828",
          soft: "#1D2939",
          body: "#344054",
          muted: "#475467",
          faint: "#5D6679",
          ghost: "#667085",
          wisp: "#98A2B3",
        },
        danger: "#D92D20",
      },
      fontFamily: {
        // Wired up in app/layout.tsx via next/font.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        display: ["56px", { lineHeight: "1.06", letterSpacing: "-0.03em" }],
      },
      letterSpacing: {
        label: "0.08em",
        eyebrow: "0.06em",
        chip: "0.04em",
      },
      borderRadius: {
        panel: "14px",
        card: "12px",
        well: "12px",
      },
      boxShadow: {
        tab: "0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)",
        raised: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.05)",
        lifted: "0 4px 8px -2px rgba(16,24,40,.08), 0 2px 4px -2px rgba(16,24,40,.04)",
        pop: "0 12px 16px -4px rgba(16,24,40,.08), 0 4px 6px -2px rgba(16,24,40,.03)",
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
