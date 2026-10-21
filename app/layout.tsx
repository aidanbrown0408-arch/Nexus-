import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Inter for everything; IBM Plex Mono only for times and technical bits.
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Nexus — An assistant you can just talk to",
    template: "%s · Nexus",
  },
  description:
    "Nexus reads your inbox and calendar, tells you what actually needs you today, and handles the replies and the scheduling while you keep moving.",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "Nexus — An assistant you can just talk to",
    description:
      "One morning brief, edit-in-place actions, and voice or text — the same assistant either way.",
    siteName: "Nexus",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Nexus — An assistant you can just talk to",
    description:
      "One morning brief, edit-in-place actions, and voice or text — the same assistant either way.",
  },
};

// themeColor lives here rather than in `metadata`. Next 14 moved it, and
// leaving it in the metadata export logged an "Unsupported metadata"
// warning on every route it rendered.
export const viewport: Viewport = {
  themeColor: "#F5F7FA",
  width: "device-width",
  initialScale: 1,
};

// Clerk's own UI is themed here so sign-in, sign-up and the user menu
// match the rest of the app.
const clerkAppearance = {
  variables: {
    colorPrimary: "#155EEF",
    colorText: "#101828",
    colorTextSecondary: "#475467",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FFFFFF",
    colorInputText: "#101828",
    borderRadius: "8px",
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  },
  elements: {
    card: "rounded-[14px] border border-[#E4E7EC] shadow-[0_12px_16px_-4px_rgba(16,24,40,.08),0_4px_6px_-2px_rgba(16,24,40,.03)]",
    headerTitle: "tracking-tight",
    formButtonPrimary:
      "rounded-lg bg-[#155EEF] hover:bg-[#004EEB] text-sm font-semibold normal-case shadow-none",
    formFieldInput:
      "rounded-lg border-[#D0D5DD] bg-white focus:border-[#84ADFF] focus:ring-4 focus:ring-[#D1E0FF]",
    socialButtonsBlockButton: "rounded-lg border-[#D0D5DD]",
    footerActionLink: "text-[#155EEF] hover:text-[#004EEB] font-semibold",
  },
};

// ClerkProvider makes the signed-in user's session available to every page
// and component in the app (via hooks like useUser, and server helpers
// like currentUser()). It has to wrap the whole app, so it lives here in
// the root layout.
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en" className={`${sans.variable} ${mono.variable}`}>
        <body className="font-sans">{children}</body>
      </html>
    </ClerkProvider>
  );
}
