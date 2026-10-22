import type { MetadataRoute } from "next";

// Lets Nexus be added to a phone's home screen and open like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nexus",
    short_name: "Nexus",
    description:
      "An assistant that reads your inbox and calendar, and tells you what actually needs you today.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F5F7FA",
    theme_color: "#F5F7FA",
    icons: [
      { src: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
