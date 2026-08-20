import { getSupabaseAdmin, type UserFactRow } from "./supabase";

// What Nexus remembers.
//
// ROADMAP.md's memory layer: short facts about the user, written by
// Claude as it reads their mail and calendar, read back into the prompt
// on every call. "Sarah Chen is their co-founder." "The Q3 budget is due
// Oct 15." "They don't take meetings before 10."
//
// This is Layer 2 territory — inferred, not told — which is exactly why
// it carries the machinery the onboarding profile doesn't need. Three
// rules from the roadmap, and each one is enforced here in code rather
// than asked for in a prompt:
//
//   - **Every fact has a source.** A fact whose `source_id` isn't one of
//     the messages or events actually handed to the model on that run is
//     dropped. Same enforcement the brief uses on news headlines, for the
//     same reason: a model told to cite can still not cite.
//   - **Every fact is visible and deletable.** /dashboard/memory lists
//     them; deleting one really deletes the row.
//   - **Facts expire.** A deadline from four months ago is noise, and
//     noise in a prompt is worse than an empty prompt because it reads as
//     confident.
//
// Retrieval is keyword overlap, deliberately. Vector search is a later
// optimization; at a few dozen facts per user it would be machinery
// bought to solve a problem nobody has yet.

export type FactCategory =
  // Who someone is to the user: "Marcus is their co-founder."
  | "person"
  // Something with a date attached that stops mattering after it.
  | "deadline"
  // A piece of work in flight: "They're raising a seed round."
  | "project"
  // How they work: "They don't take meetings before 10."
  | "preference";

export const FACT_CATEGORIES: FactCategory[] = [
  "person",
  "deadline",
  "project",
  "preference",
];

export type Fact = {
  id: string;
  category: FactCategory;
  fact: string;
  /** Which message or event this was read out of. Never empty. */
  sourceId: string;
  /** A subject line or event title, snapshotted so the source stays legible. */
  sourceLabel: string | null;
  sourceKind: "email" | "calendar" | null;
  expiresAt: string | null;
  createdAt: string;
};

export type NewFact = {
  category: FactCategory;
  fact: string;
  sourceId: string;
  sourceLabel: string | null;
  sourceKind: "email" | "calendar" | null;
  expiresAt: string | null;
};

// Caps. All three are about the prompt, not the database: a memory that
// grows without bound quietly becomes the largest thing in every call.
const MAX_FACT_CHARS = 240;
const MIN_FACT_CHARS = 8;
const MAX_NEW_FACTS = 6;
export const MAX_PROMPT_FACTS = 12;

// A deadline whose date the model didn't give us still has to expire, or
// "the board deck is due Friday" outlives the Friday and keeps being
// asserted. A month is long enough for anything worth writing down and
// short enough that a stale one falls out on its own.
const UNDATED_DEADLINE_DAYS = 30;
// Nothing is remembered longer than this without being re-observed.
const MAX_EXPIRY_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

// --- pure logic ---------------------------------------------------------

// Dedupe key. Two facts that differ only in punctuation or capitalisation
// are the same fact said twice, and a prompt that says it twice reads as
// emphasis the user never asked for.
export function normalizeFact(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "they", "their", "them",
  "from", "have", "has", "had", "was", "were", "are", "is", "be", "been",
  "about", "into", "over", "than", "then", "there", "here", "what", "when",
  "who", "whom", "will", "would", "should", "could", "does", "did", "not",
  "you", "your", "user", "users", "his", "her", "him", "she", "its",
  "one", "two", "any", "all", "but", "out", "off", "how", "why", "some",
]);

function tokens(text: string): string[] {
  const matched = text.toLowerCase().match(/[a-z0-9']{3,}/g) ?? [];
  return matched.filter((word) => !STOPWORDS.has(word));
}

function isExpired(fact: { expiresAt: string | null }, now: Date): boolean {
  if (!fact.expiresAt) return false;
  const at = new Date(fact.expiresAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() <= now.getTime();
}

/** Drop anything past its date. Applied on read as well as by the prune,
 *  because a fact that expired an hour ago shouldn't wait for the next
 *  brief to stop being asserted. */
export function liveFacts(facts: Fact[], now: Date = new Date()): Fact[] {
  return facts.filter((fact) => !isExpired(fact, now));
}

/**
 * Which facts are worth spending prompt on for this particular call.
 *
 * Keyword overlap between the fact and whatever context the call is
 * about — today's subjects and senders for a brief, the question itself
 * for chat. Preferences get a floor rather than needing a keyword match:
 * "no meetings before 10" is relevant to a scheduling question that
 * shares none of its words, which is the case a pure overlap score gets
 * exactly backwards.
 *
 * With no context to match against, the newest facts win — the same
 * order the memory page shows.
 */
export function selectFacts(
  facts: Fact[],
  context: string,
  limit: number = MAX_PROMPT_FACTS
): Fact[] {
  const newestFirst = [...facts].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  const haystack = new Set(tokens(context));
  if (!haystack.size) return newestFirst.slice(0, limit);

  return newestFirst
    .map((fact) => {
      const overlap = tokens(fact.fact).filter((word) =>
        haystack.has(word)
      ).length;
      return {
        fact,
        score: overlap + (fact.category === "preference" ? 1 : 0),
      };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.fact);
}

/**
 * Validate what the model claimed to have learned.
 *
 * `sources` is the set of message ids and event keys the model was
 * actually shown on this run. A fact citing anything else is discarded
 * on the assumption that a model which invented the citation invented
 * the fact — the same call the brief makes about a paraphrased headline.
 *
 * `existing` is the normalized text of what's already remembered, so a
 * fact re-observed every morning is stored once.
 */
export function sanitizeExtractedFacts(
  raw: unknown,
  options: {
    sources: Map<string, { kind: "email" | "calendar"; label: string }>;
    existing: Iterable<string>;
    now?: Date;
  }
): NewFact[] {
  if (!Array.isArray(raw)) return [];
  const now = options.now ?? new Date();
  const seen = new Set(options.existing);
  const out: NewFact[] = [];

  for (const entry of raw) {
    if (out.length >= MAX_NEW_FACTS) break;
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;

    const text = typeof item.fact === "string" ? item.fact.trim() : "";
    if (text.length < MIN_FACT_CHARS) continue;

    // A category outside the enum means the model wasn't following the
    // schema, so guessing one for it would be guessing at the rest too.
    const category = item.category as FactCategory;
    if (!FACT_CATEGORIES.includes(category)) continue;

    const sourceId = typeof item.sourceId === "string" ? item.sourceId : "";
    const source = options.sources.get(sourceId);
    if (!source) continue;

    const key = normalizeFact(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    out.push({
      category,
      fact: text.slice(0, MAX_FACT_CHARS),
      sourceId,
      sourceLabel: source.label.slice(0, 200) || null,
      sourceKind: source.kind,
      expiresAt: resolveExpiry(item.expiresAt, category, now),
    });
  }

  return out;
}

// A date the model supplied, clamped into something usable: nothing in
// the past (already noise on arrival), nothing beyond a year (a fact
// nobody has re-observed in a year should be re-earned), and a fallback
// window for deadlines that arrived without one.
function resolveExpiry(
  raw: unknown,
  category: FactCategory,
  now: Date
): string | null {
  const fallback =
    category === "deadline"
      ? new Date(now.getTime() + UNDATED_DEADLINE_DAYS * DAY_MS).toISOString()
      : null;

  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return fallback;

  const ceiling = now.getTime() + MAX_EXPIRY_DAYS * DAY_MS;
  if (at.getTime() <= now.getTime()) return fallback;
  return new Date(Math.min(at.getTime(), ceiling)).toISOString();
}

/** The block that goes into a system prompt. Empty string when there's
 *  nothing worth saying, so callers can concatenate unconditionally. */
export function factsToPromptContext(facts: Fact[]): string {
  if (!facts.length) return "";

  const lines = facts.map((fact) => `- ${fact.fact}`);
  return (
    " Notes you have taken about this user while reading their mail and " +
    "calendar on previous days:\n" +
    lines.join("\n") +
    "\nThese are your own earlier observations, not something the user " +
    "confirmed, and some may be out of date. Use them to interpret what " +
    "you are seeing today — never repeat one back as news, and never " +
    "state one as fact if today's data contradicts it."
  );
}

// --- storage ------------------------------------------------------------

function toFact(row: UserFactRow): Fact {
  return {
    id: row.id,
    category: row.category as FactCategory,
    fact: row.fact,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    sourceKind: (row.source_kind as Fact["sourceKind"]) ?? null,
    expiresAt: row.expires_at,
    createdAt: row.created_at ?? new Date().toISOString(),
  };
}

export async function listFacts(
  userId: string,
  limit = 200
): Promise<Fact[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_facts")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as UserFactRow[]).map(toFact);
}

/**
 * What a prompt should be told, for a call about `context`.
 *
 * Never throws. Memory is additive — a user whose facts can't be read
 * gets exactly the brief they got before this existed — so every caller
 * treats an unreadable memory as an empty one.
 */
export async function recallFacts(
  userId: string,
  context: string,
  limit: number = MAX_PROMPT_FACTS
): Promise<Fact[]> {
  try {
    const facts = liveFacts(await listFacts(userId));
    return selectFacts(facts, context, limit);
  } catch (err) {
    console.error("Memory read failed", err);
    return [];
  }
}

/**
 * Store what was learned on this run.
 *
 * Never throws, for the same reason `logAction` doesn't: a brief that
 * failed because remembering failed is a worse outcome than a brief that
 * forgot something.
 */
export async function rememberFacts(
  userId: string,
  facts: NewFact[]
): Promise<number> {
  if (!facts.length) return 0;
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("user_facts")
      .insert(
        facts.map((fact) => ({
          user_id: userId,
          category: fact.category,
          fact: fact.fact,
          source_id: fact.sourceId,
          source_label: fact.sourceLabel,
          source_kind: fact.sourceKind,
          expires_at: fact.expiresAt,
        }))
      )
      .select("id");

    if (error) throw error;
    return (data ?? []).length;
  } catch (err) {
    console.error("Memory write failed", err);
    return 0;
  }
}

/** User-initiated. Unlike the action log, forgetting really is deletion —
 *  "you can delete it" means nothing if the row survives. */
export async function forgetFact(
  userId: string,
  id: string
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("user_facts")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id");

  if (error) throw error;
  return Boolean((data ?? []).length);
}

/** Sweep out what has expired. Called from the brief, which runs about
 *  once a day per user — often enough to keep the table honest, rarely
 *  enough that nobody is paying for a cleanup on every page load. */
export async function pruneExpiredFacts(userId: string): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("user_facts")
      .delete()
      .eq("user_id", userId)
      .not("expires_at", "is", null)
      .lte("expires_at", new Date().toISOString());
    if (error) throw error;
  } catch (err) {
    console.error("Memory prune failed", err);
  }
}
