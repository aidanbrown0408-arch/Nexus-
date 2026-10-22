// The Nexus mark as plain markup for next/og (ImageResponse), which renders
// a subset of CSS and no Tailwind. Same geometry as app/Logo.tsx.
export function BrandMark({
  size,
  square = false,
}: {
  size: number;
  // iOS masks home-screen icons itself; a pre-rounded one gets dark corners.
  square?: boolean;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: square ? 0 : size * 0.22,
        background: "linear-gradient(135deg, #2970FF 0%, #0040C1 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
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
    </div>
  );
}
