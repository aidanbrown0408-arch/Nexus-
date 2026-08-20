// The interview itself, as data.
//
// This file is imported by both the wizard (a client component) and the
// API route that validates what it sends back, so it deliberately has no
// imports — pulling in lib/supabase here would drag the service role key
// into the browser bundle.
//
// Questions are declared rather than hardcoded into JSX so the two sides
// can't drift: the route validates against the same `field` and `options`
// list the wizard rendered from.

export type QuestionKind = "text" | "textarea" | "list" | "choice" | "multi" | "time";

export type Question = {
  /** Column on `user_profile`. Also the wire key the wizard PATCHes. */
  field: string;
  kind: QuestionKind;
  prompt: string;
  /** Shown under the prompt — why Nexus is asking, in one line. */
  help?: string;
  placeholder?: string;
  /** For `choice` and `multi`. `value` is what's stored. */
  options?: { value: string; label: string }[];
  /**
   * `other` on a choice question reveals a free-text box, stored in this
   * companion column. Only `sector` uses it today.
   */
  otherField?: string;
};

export type Section = {
  id: string;
  title: string;
  /** Core runs automatically; the rest are offered after it. */
  optional: boolean;
  /** Shown on the "tell Nexus more?" screen, not during the questions. */
  pitch?: string;
  questions: Question[];
};

export const SECTORS = [
  { value: "law", label: "Law" },
  { value: "medicine", label: "Medicine / healthcare" },
  { value: "finance", label: "Finance / accounting" },
  { value: "tech", label: "Tech" },
  { value: "real_estate", label: "Real estate" },
  { value: "education", label: "Education" },
  { value: "consulting", label: "Consulting" },
  { value: "other", label: "Something else" },
];

export const NEWS_OPTIONS = [
  { value: "financial", label: "Financial markets" },
  { value: "industry", label: "News from my industry" },
  { value: "us", label: "U.S. news" },
  { value: "world", label: "World news" },
];

// "general" was one option covering both domestic and world news before
// they were split. It is no longer offered, but profiles written before
// the split still hold it, and dropping an unrecognized value silently
// would take away news a user had actually asked for. Read support only
// — nothing writes it now.
// Null-prototype so a stored value of "constructor" or "toString" is a
// miss rather than a function. Unreachable today because writes are
// whitelisted, and one character of defence against it ever changing.
export const LEGACY_NEWS_OPTIONS: Record<string, string[]> = Object.assign(
  Object.create(null),
  { general: ["us", "world"] }
);

export const SECTIONS: Section[] = [
  {
    id: "core",
    title: "The basics",
    optional: false,
    questions: [
      {
        field: "role_description",
        kind: "text",
        prompt: "What do you do, in one line?",
        help: "This is most of how Nexus works out what counts as urgent for you.",
        placeholder: "Founder at a 12-person startup",
      },
      {
        field: "sector",
        kind: "choice",
        prompt: "What sector do you work in?",
        help: "A filing deadline, an on-call page and a month-end close are all “urgent” — but they don’t look alike.",
        options: SECTORS,
        otherField: "sector_other",
      },
      {
        field: "vips",
        kind: "list",
        prompt: "Whose email should never get buried?",
        help: "Names, email addresses, or just who they are to you. One per line.",
        placeholder: "Sarah Chen\nmy co-founder\nlandlord",
      },
      {
        field: "current_focus",
        kind: "textarea",
        prompt: "What’s on your plate this week that you’d hate to drop?",
        help: "The single most useful thing you can tell Nexus. You can change it any time.",
        placeholder: "Closing the seed round — anything from investors matters this week.",
      },
      {
        field: "noise_filters",
        kind: "list",
        prompt: "What should Nexus stop showing you?",
        help: "Whatever’s noise for you specifically. One per line.",
        placeholder: "newsletters\nreceipts\nrecruiter email",
      },
      {
        field: "morning_time",
        kind: "time",
        prompt: "When does your morning start?",
        help: "Your brief will be ready by then.",
      },
      {
        field: "news_preferences",
        kind: "multi",
        prompt: "Want any news in your brief?",
        help: "Most people want none — leaving this empty keeps the brief to your mail and calendar.",
        options: NEWS_OPTIONS,
      },
      {
        field: "brief_wishlist",
        kind: "textarea",
        prompt: "Anything else you’d want in your morning brief?",
        help: "Optional. Anything we haven’t asked about — in your own words.",
        placeholder: "Tell me if a court date moves. Include weather if I have an outdoor showing.",
      },
    ],
  },
  {
    id: "style",
    title: "How you communicate",
    optional: true,
    pitch: "So drafts sound like you, not like an assistant.",
    questions: [
      {
        field: "draft_tone",
        kind: "choice",
        prompt: "When Nexus drafts something for you, how should it read?",
        options: [
          { value: "short", label: "Short and direct" },
          { value: "warm", label: "Warmer, a bit more detail" },
        ],
      },
      {
        field: "urgency_style",
        kind: "choice",
        prompt: "How do you want to hear about something urgent?",
        options: [
          { value: "direct", label: "Just the facts" },
          { value: "contextual", label: "Give me a little context first" },
        ],
      },
    ],
  },
  {
    id: "company",
    title: "Your company",
    optional: true,
    pitch: "So Nexus can weigh business priorities, not just inbox noise.",
    questions: [
      {
        field: "company_description",
        kind: "text",
        prompt: "What does your company do, in one line?",
        placeholder: "Payments infrastructure for marketplaces",
      },
      {
        field: "company_stage",
        kind: "choice",
        prompt: "What stage is it at?",
        options: [
          { value: "pre_seed", label: "Pre-seed / just starting" },
          { value: "bootstrapped", label: "Bootstrapped, making revenue" },
          { value: "funded", label: "Funded and scaling" },
          { value: "established", label: "Established company" },
        ],
      },
      {
        field: "team_size_range",
        kind: "choice",
        prompt: "Roughly how big is the team?",
        options: [
          { value: "solo", label: "Just me" },
          { value: "2_10", label: "2–10" },
          { value: "11_50", label: "11–50" },
          { value: "51_200", label: "51–200" },
          { value: "200_plus", label: "200+" },
        ],
      },
    ],
  },
  {
    id: "rhythms",
    title: "Your hours",
    optional: true,
    pitch: "So Nexus knows when to leave you alone.",
    questions: [
      {
        field: "quiet_hours",
        kind: "text",
        prompt: "Any hours you don’t want interrupted?",
        help: "Plain language is fine.",
        placeholder: "Nothing before 9am; 1–3pm is deep work",
      },
      {
        field: "weekend_contact",
        kind: "choice",
        prompt: "Should Nexus reach you on weekends?",
        options: [
          { value: "never", label: "No — hold it for Monday" },
          { value: "urgent_only", label: "Only if it’s actually urgent" },
          { value: "yes", label: "Yes, same as weekdays" },
        ],
      },
    ],
  },
];

export const CORE_SECTION = SECTIONS[0];
export const OPTIONAL_SECTIONS = SECTIONS.filter((s) => s.optional);

/** Every question across every section, for validation. */
export const ALL_QUESTIONS: Question[] = SECTIONS.flatMap((s) => s.questions);

export function findQuestion(field: string): Question | undefined {
  return ALL_QUESTIONS.find((q) => q.field === field);
}
