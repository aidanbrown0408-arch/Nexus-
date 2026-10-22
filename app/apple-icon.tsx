import { ImageResponse } from "next/og";
import { BrandMark } from "./brandMark";

// The icon iOS uses when Nexus is added to the home screen.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<BrandMark size={180} square />, size);
}
