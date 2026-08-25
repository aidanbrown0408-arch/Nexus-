import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Instrument Sans for everything, IBM Plex Mono for the small uppercase
// labels — the pairing the design canvas is built on.
const sans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
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
  title: "Nexus",
  description: "Your AI personal assistant for email and calendar",
};

// Clerk's own UI is themed here so sign-in, sign-up and the user menu
// sit in the same warm-paper, pill-shaped world as the rest of the app.
const clerkAppearance = {
  variables: {
    colorPrimary: "#007781",
    colorText: "#1B1A17",
    colorTextSecondary: "#6B6862",
    colorBackground: "#FFFFFF",
    colorInputBackground: "#FBFAF8",
    colorInputText: "#1B1A17",
    borderRadius: "9999px",
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  },
  elements: {
    card: "rounded-[20px] border border-[#E4E1DA] shadow-none",
    headerTitle: "tracking-tight",
    formButtonPrimary:
      "rounded-full bg-[#007781] hover:bg-[#00606A] text-sm font-medium normal-case",
    formFieldInput: "rounded-full border-[#E4E1DA] bg-[#FBFAF8]",
    socialButtonsBlockButton: "rounded-full border-[#E4E1DA]",
    footerActionLink: "text-[#007781] hover:text-[#00606A]",
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
