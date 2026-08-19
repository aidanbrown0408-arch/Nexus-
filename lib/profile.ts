import { getSupabaseAdmin } from "./supabase";
import {
  findQuestion,
  SECTORS,
  NEWS_OPTIONS,
  LEGACY_NEWS_OPTIONS,
} from "./onboarding-questions";

// What the user told Nexus about themselves — the onboarding interview,
// stored flat.
//
// This is Layer 1 from ROADMAP.md: explicitly told, not inferred. That's
// why it's one wide row rather than the fact-table-with-sources shape the
// inferred layer will eventually want — there's no provenance to track
// when the user typed it themselves.
//
// Two conventions worth knowing before editing:
//
//   - Every field is nullable except the key. A half-finished interview
//     is a normal state, not a broken one, so nothing here can be assumed
//     present at read time.
//   - `completed_at` null means the user skipped or is mid-flow. It's the
//     only thing that distinguishes "asked and declined" from "never
//     asked", which is what the dashboard redirect turns on.

export type UserProfileRow = {
  user_id: string;

  // Core
  role_description: string | null;
  sector: string | null;
  sector_other: string | null;
  vips: string[] | null;
  current_focus: string | null;
  noise_filters: string[] | null;
  morning_time: string | null;
  timezone: string | null;
  news_preferences: string[] | null;
  brief_wishlist: string | null;

  // Optional — communication style
  draft_tone: string | null;
  urgency_style: string | null;

  // Optional — company context
  company_description: string | null;
  company_stage: string | null;
  team_size_range: string | null;

  // Optional — work rhythms
  quiet_hours: string | null;
  weekend_contact: string | null;

  completed_at: string | null;
  created_at?: string;
  updated_at?: string;
};

const MAX_TEXT = 500;
const MAX_LIST_ITEMS = 10;
const MAX_LIST_ITEM = 120;

// --- reads --------------------------------------------------------------

export async function getProfile(
  userId: string
): Promise<UserProfileRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_profile")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as UserProfileRow) ?? null;
}

// Whether this user has been through onboarding at all — completed or
// skipped. The dashboard uses this to decide on redirecting, so it stays
// a cheap existence check rather than pulling the whole row.
export async function hasSeenOnboarding(userId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_profile")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

// --- writes -------------------------------------------------------------

function clampText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

function clampList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, MAX_LIST_ITEM))
    .slice(0, MAX_LIST_ITEMS);
  // Empty is meaningful for these — "no VIPs", "no news" are real answers,
  // distinct from never having been asked — so keep the array rather than
  // collapsing it to null.
  return items;
}

// Only fields the interview actually declares can be written, and choice
// answers have to be one of the offered values. The wizard is the only
// caller today, but it's a browser talking to a service-role-backed route,
// so what it sends is untrusted input like any other.
export function sanitizeAnswers(
  input: Record<string, unknown>
): Partial<UserProfileRow> {
  const patch: Record<string, unknown> = {};

  for (const [field, raw] of Object.entries(input)) {
    // Timezone rides along with the morning-time answer rather than being
    // its own question — the browser knows it and asking would be silly.
    if (field === "timezone") {
      patch.timezone = clampText(raw);
      continue;
    }

    const question = findQuestion(field);
    if (!question) continue;

    switch (question.kind) {
      case "text":
      case "textarea":
      case "time":
        patch[field] = clampText(raw);
        break;

      case "list":
      case "multi": {
        const list = clampList(raw);
        if (list === null) break;
        if (question.options) {
          const allowed = new Set(question.options.map((o) => o.value));
          patch[field] = list.filter((item) => allowed.has(item));
        } else {
          patch[field] = list;
        }
        break;
      }

      case "choice": {
        const value = clampText(raw);
        const allowed = new Set((question.options ?? []).map((o) => o.value));
        patch[field] = value && allowed.has(value) ? value : null;
        break;
      }
    }

    // The free-text companion to an "other" choice. Kept only while the
    // choice is still "other", so switching away doesn't leave a stale
    // string behind to confuse the prompt builder.
    if (question.otherField && field in input) {
      const other = clampText(input[question.otherField]);
      patch[question.otherField] = patch[field] === "other" ? other : null;
    }
  }

  return patch as Partial<UserProfileRow>;
}

// Upsert rather than update: the row is created by the first answer, not
// ahead of time, so a user who abandons the interview at question one
// still has whatever they gave us.
export async function saveAnswers(
  userId: string,
  patch: Partial<UserProfileRow>
): Promise<UserProfileRow> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_profile")
    .upsert(
      {
        user_id: userId,
        ...patch,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single();

  if (error) throw error;
  return data as UserProfileRow;
}

// Finishing and skipping write the same row; the difference is whether
// `completed_at` gets set. Both count as "seen", so neither one leaves the
// user getting redirected back into the interview on their next visit.
export async function markOnboardingSeen(
  userId: string,
  completed: boolean
): Promise<void> {
  await saveAnswers(userId, {
    completed_at: completed ? new Date().toISOString() : null,
  });
}

// --- using it -----------------------------------------------------------

function labelFor(
  options: { value: string; label: string }[],
  value: string | null
): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * The profile as a block of plain sentences to append to a system prompt.
 *
 * Only mentions what the user actually filled in — an empty profile
 * returns an empty string, and the caller appends nothing. This matters
 * more than it looks: telling a model "the user did not specify a sector"
 * invites it to comment on the gap, whereas silence just leaves the
 * default behavior alone.
 */
export function profileToPromptContext(
  profile: UserProfileRow | null
): string {
  if (!profile) return "";

  const lines: string[] = [];

  if (profile.role_description) {
    lines.push(`They describe their work as: ${profile.role_description}.`);
  }

  const sector =
    profile.sector === "other"
      ? profile.sector_other
      : labelFor(SECTORS, profile.sector);
  if (sector) {
    lines.push(
      `They work in ${sector}. Use the vocabulary and deadlines that ` +
        `actually matter in that field when judging what is urgent.`
    );
  }

  if (profile.vips?.length) {
    lines.push(
      `These people matter to them — surface anything from them and never ` +
        `bury it: ${profile.vips.join(", ")}.`
    );
  }

  if (profile.current_focus) {
    lines.push(`What they are focused on right now: ${profile.current_focus}`);
  }

  if (profile.noise_filters?.length) {
    lines.push(
      `They consider this noise and do not want it surfaced unless it is ` +
        `genuinely exceptional: ${profile.noise_filters.join(", ")}.`
    );
  }

  if (profile.company_description) {
    lines.push(`Their company: ${profile.company_description}`);
  }
  const stage = labelFor(
    [
      { value: "pre_seed", label: "pre-seed" },
      { value: "bootstrapped", label: "bootstrapped and revenue-generating" },
      { value: "funded", label: "funded and scaling" },
      { value: "established", label: "an established company" },
    ],
    profile.company_stage
  );
  const team = labelFor(
    [
      { value: "solo", label: "a solo operation" },
      { value: "2_10", label: "2-10 people" },
      { value: "11_50", label: "11-50 people" },
      { value: "51_200", label: "51-200 people" },
      { value: "200_plus", label: "200+ people" },
    ],
    profile.team_size_range
  );
  if (stage || team) {
    lines.push(
      `It is ${[stage, team].filter(Boolean).join(", ")}.`
    );
  }

  if (profile.urgency_style === "direct") {
    lines.push("They want the facts first. Skip preamble and cushioning.");
  } else if (profile.urgency_style === "contextual") {
    lines.push(
      "They like a sentence of context before the ask, rather than a bare fact."
    );
  }

  if (profile.draft_tone === "short") {
    lines.push("They write short and direct. Match that.");
  } else if (profile.draft_tone === "warm") {
    lines.push("They write warmly, with a little more detail. Match that.");
  }

  if (profile.quiet_hours) {
    lines.push(`They do not want to be interrupted: ${profile.quiet_hours}.`);
  }
  if (profile.weekend_contact === "never") {
    lines.push("They do not want to be contacted on weekends.");
  } else if (profile.weekend_contact === "urgent_only") {
    lines.push("On weekends, only genuinely urgent things should reach them.");
  }

  if (profile.brief_wishlist) {
    lines.push(
      `They specifically asked for this in their brief: ${profile.brief_wishlist}`
    );
  }

  if (!lines.length) return "";

  return (
    "\n\nWhat you know about this user, in their own words. Let it shape " +
    "what you lead with and how you phrase it. Never mention that you were " +
    "given this profile, and never restate it back to them.\n" +
    lines.map((line) => `- ${line}`).join("\n")
  );
}

/**
 * Which news sections, if any, the user asked for. Kept separate from the
 * prompt context because this one changes the brief's *shape* — it means
 * fetching something extra and adding a section — rather than just
 * reframing what's already there.
 */
export function newsSelections(profile: UserProfileRow | null): string[] {
  const selected = profile?.news_preferences ?? [];
  const allowed = new Set(NEWS_OPTIONS.map((o) => o.value));

  // Retired values are expanded rather than dropped. A profile saved
  // before "general headlines" became "U.S." and "World" would otherwise
  // filter down to nothing and lose news entirely, with the user having
  // changed no setting.
  const resolved = new Set<string>();
  for (const value of selected) {
    if (allowed.has(value)) {
      resolved.add(value);
      continue;
    }
    for (const replacement of LEGACY_NEWS_OPTIONS[value] ?? []) {
      if (allowed.has(replacement)) resolved.add(replacement);
    }
  }

  // Ordered by the option list so the brief's sections don't reshuffle
  // between users who ticked the same boxes in a different order.
  return NEWS_OPTIONS.map((o) => o.value).filter((value) =>
    resolved.has(value)
  );
}

/**
 * The profile as it matters to *writing in the user's name*, rather than
 * to summarizing their day.
 *
 * Deliberately not `profileToPromptContext`. That one is written for a
 * reader deciding what to surface — it says things like "surface anything
 * from them and never bury it", which is meaningless advice to a model
 * composing a reply and actively unhelpful as filler in a short prompt.
 * A drafting prompt wants identity and register and nothing else.
 */
export function profileToDraftContext(
  profile: UserProfileRow | null
): string {
  if (!profile) return "";

  const lines: string[] = [];

  if (profile.role_description) {
    lines.push(`You are writing as someone who: ${profile.role_description}.`);
  }

  const sector =
    profile.sector === "other"
      ? profile.sector_other
      : labelFor(SECTORS, profile.sector);
  if (sector) {
    lines.push(`They work in ${sector}.`);
  }

  if (profile.company_description) {
    lines.push(`Their company: ${profile.company_description}`);
  }

  // The interview's own words for these two options, turned into
  // instructions a drafting model can follow. "short" is the common
  // answer and the one people notice being ignored.
  if (profile.draft_tone === "short") {
    lines.push(
      "They write short and direct. Keep replies to a few sentences, cut " +
        "pleasantries, and never pad to sound polite."
    );
  } else if (profile.draft_tone === "warm") {
    lines.push(
      "They write warmly and with a little more detail — a friendly opener " +
        "and a real sign-off, not a clipped one-liner."
    );
  }

  if (profile.urgency_style === "direct") {
    lines.push("Lead with the point. No preamble, no cushioning.");
  } else if (profile.urgency_style === "contextual") {
    lines.push("A sentence of context before the ask reads better to them.");
  }

  if (profile.current_focus) {
    lines.push(
      `What they are focused on right now, in case the thread touches it: ` +
        `${profile.current_focus}`
    );
  }

  if (profile.vips?.length) {
    lines.push(
      `These people matter to them — if the reply is going to one of them, ` +
        `take more care with it: ${profile.vips.join(", ")}.`
    );
  }

  if (!lines.length) return "";

  return (
    "\n\nWhat you know about the person you are writing as. Let it shape " +
    "the voice, never the facts. Never mention that you were given any of " +
    "this, and never write about them in the third person.\n" +
    lines.map((line) => `- ${line}`).join("\n")
  );
}

/**
 * The VIP list, normalized for matching against a sender.
 *
 * The interview asks for VIPs in free text, so a row holds a mix of
 * "Sarah Chen", "sarah@acme.com", and "my co-founder Marcus". Terms
 * shorter than three characters are dropped — an initial would match
 * half an inbox, and a false VIP is worse than a missed one here,
 * because it silently removes things from the archive list.
 */
export function vipTerms(profile: UserProfileRow | null): string[] {
  return (profile?.vips ?? [])
    .map((vip) => vip.trim().toLowerCase())
    .filter((vip) => vip.length >= 3);
}

/**
 * Whether a sender looks like someone on the VIP list.
 *
 * An emailish term has to match the address exactly — a substring match
 * on an address would let "sarah@acme.com" match a forwarding alias that
 * merely contains it. Everything else matches loosely against the display
 * name and the local part, because "Sarah Chen" has to find
 * "sarah.chen@acme.com" and people write their VIPs as names.
 */
export function matchesVip(
  from: string,
  fromEmail: string,
  terms: string[]
): boolean {
  if (!terms.length) return false;

  const name = from.toLowerCase();
  const email = fromEmail.toLowerCase();
  const localPart = email.split("@")[0] ?? "";

  return terms.some((term) => {
    if (term.includes("@")) return email === term;
    if (name.includes(term) || email.includes(term)) return true;
    // "Sarah Chen" against "sarah.chen@acme.com": the address has no
    // spaces, so compare against a de-punctuated local part too.
    const flat = localPart.replace(/[._\-+]/g, " ");
    return flat.includes(term);
  });
}
