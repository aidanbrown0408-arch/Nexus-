// The Nexus mark: three connected nodes on a teal tile — a literal
// "nexus", and small enough to read at 28px in the header.
export default function Logo({
  size = 28,
  withWordmark = true,
  className = "",
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-[9px] bg-gradient-to-br from-accent-500 to-accent-800 shadow-[inset_0_1px_0_rgba(255,255,255,.25),0_1px_2px_rgba(0,54,60,.25)]"
        style={{ width: size, height: size }}
      >
        <svg
          viewBox="0 0 24 24"
          width={size * 0.62}
          height={size * 0.62}
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 17 12 7l6 10" opacity=".85" />
          <path d="M6 17h12" opacity=".55" />
          <circle cx="12" cy="7" r="2.4" fill="white" stroke="none" />
          <circle cx="6" cy="17" r="2.4" fill="white" stroke="none" />
          <circle cx="18" cy="17" r="2.4" fill="white" stroke="none" />
        </svg>
      </span>
      {withWordmark && (
        <span className="text-[20px] font-semibold tracking-tight text-ink">
          Nexus
        </span>
      )}
    </span>
  );
}
