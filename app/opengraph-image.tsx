import { ImageResponse } from "next/og";
import { BrandMark } from "./brandMark";

// The preview card shown when a Nexus link is shared in Messages, Slack,
// LinkedIn and the like. Twitter/X uses it too (see twitter-image.tsx).
export const alt = "Nexus — an assistant that has already read your inbox";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 80,
          background: "#F5F7FA",
          color: "#101828",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <BrandMark size={72} />
          <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>
            Nexus
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: -2,
              maxWidth: 900,
            }}
          >
            An assistant that has already read your inbox.
          </div>
          <div style={{ fontSize: 30, color: "#475467", maxWidth: 900 }}>
            One morning brief, replies drafted for you, and every change
            undoable — by voice or text.
          </div>
        </div>
      </div>
    ),
    size
  );
}
