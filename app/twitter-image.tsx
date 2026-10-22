import OpenGraphImage from "./opengraph-image";

// Same card as opengraph-image. Route config has to be declared in this
// file — Next reads it statically, so a re-export isn't picked up.
export const alt = "Nexus — an assistant that has already read your inbox";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function TwitterImage() {
  return OpenGraphImage();
}
