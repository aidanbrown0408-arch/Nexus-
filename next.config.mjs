/** @type {import('next').NextConfig} */

// Headers every response carries. A full Content-Security-Policy is left
// out on purpose: Clerk, Google fonts and the voice providers each need
// their own allowances, and a CSP that's wrong breaks sign-in. The ones
// here are safe for every page.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nexus is never meant to be framed; this stops clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // The microphone is used for voice chat, on this origin only.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=()" },
];

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
