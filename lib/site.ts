// Public-facing details used by the legal pages, the footer and the
// metadata. Fill these in before launch — they are what users, Google's
// OAuth reviewers and app stores will read.
export const SITE = {
  name: "Nexus",
  // The legal entity that operates the service (e.g. "Nexus Labs LLC").
  legalEntity: "Nexus",
  contactEmail: "hello@nexus.app",
  privacyEmail: "privacy@nexus.app",
  // The jurisdiction whose law governs the Terms (e.g. "the State of New York").
  governingLaw: "the State of New York, United States",
  // Update whenever either policy changes in substance.
  policiesEffective: "October 21, 2026",
} as const;
