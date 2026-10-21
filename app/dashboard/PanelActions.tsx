"use client";

// Small icon buttons for panel headers (refresh, full screen, collapse).
// Replacing the old row of text links keeps each header to one clean
// line; every button still carries a label for screen readers and a
// tooltip on hover.

type IconName =
  | "refresh"
  | "maximize"
  | "minimize"
  | "chevron-up"
  | "chevron-down"
  | "plus"
  | "sparkles"
  | "x";

const PATHS: Record<IconName, JSX.Element> = {
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
  maximize: (
    <path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" />
  ),
  minimize: (
    <path d="M4 14h6v6M20 10h-6V4M14 10l6.5-6.5M10 14l-6.5 6.5" />
  ),
  "chevron-up": <path d="m6 15 6-6 6 6" />,
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sparkles: (
    <>
      <path d="M12 3.5 13.8 8.2 18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8Z" />
      <path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
};

export function PanelIcon({
  name,
  className = "",
  size = 16,
}: {
  name: IconName;
  className?: string;
  size?: number;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}

export function PanelIconButton({
  icon,
  label,
  onClick,
  disabled,
  spinning,
  pressed,
  expanded,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  pressed?: boolean;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-ghost transition-colors hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
    >
      <PanelIcon name={icon} className={spinning ? "animate-spin" : ""} />
    </button>
  );
}
