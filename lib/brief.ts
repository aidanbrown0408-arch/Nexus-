import { getAuthorizedClientForUser } from "@/lib/google";
import { fetchRecentMessages } from "@/lib/gmail";
import { gatherEvents } from "@/lib/calendar-sources";
import { listPrepItems } from "@/lib/prep";
import type { EventSummary } from "@/lib/events";
import { getAnthropicClient, BRIEF_MODEL } from "@/lib/anthropic";
import { errorMessage } from "@/lib/supabase";
import { dayKey, nowLines, resolveTimezone } from "@/lib/clock";
import {
  pruneOtherDays,
  readCachedBrief,
  writeCachedBrief,
} from "@/lib/brief-cache";
import {
  getProfile,
  profileToPromptContext,
  newsSelections,
  type UserProfileRow,
} from "@/lib/profile";
import {
  fetchNewsHighlights,
  type NewsArticle,
  type NewsCategory,
} from "@/lib/news";
import {
  selectFacts,
  rememberFacts,
  pruneExpiredFacts,
  sanitizeExtractedFacts,
  factsToPromptContext,
  normalizeFact,
  listFacts,
  liveFacts,
  FACT_CATEGORIES,
  type Fact,
} from "@/lib/memory";
import {
  fetchMarketSnapshot,
  isMarketsConfigured,
  type MarketSnapshot,
} from "@/lib/markets";

// Pull a few more than we keep — most of the recent window is usually read,
// and unread is what the brief is about.
const MESSAGE_FETCH_LIMIT = 40;
const MAX_UNREAD = 15;
const SNIPPET_CHARS = 300;
const CALENDAR_DAYS = 2;

export type Priority = {
  title: string;
  reason: string;
  source: "email" | "calendar" | "both";
  sourceId?: string;
};

// No editorial "take" field — Claude's title and URL are guaranteed real
// (see resolveNewsHighlights), but a written interpretation of what the
// article means would carry the same trust level as anything else in the
// brief, i.e. it could still be wrong even grounded on a real summary.
// Keeping this to plain fact — headline, source, category — trades away
// personalization for a hard guarantee: nothing shown here can misstate
// what the article actually says, because nothing here is generated.
export type NewsHighlight = {
  title: string;
  source: string;
  url: string;
  category: NewsCategory;
};

export type Brief = {
  greeting: string;
  headline: string;
  priorities: Priority[];
  scheduleNote: string;
  calendarUnavailable?: boolean;
  // Same idea as calendarUnavailable: unread mail couldn't be fetched
  // (typically an expired/revoked Google token), so the brief was built
  // from calendar alone rather than failing outright.
  mailUnavailable?: boolean;
  newsHighlights?: NewsHighlight[];
  // A written read on markets and world events. Unlike the headlines and
  // the quote tiles — which are passed through verbatim precisely so
  // nothing can be misstated — this one IS generated, which is a real
  // change in the trust level of the card. It is grounded hard: only the
  // provided summaries and the exact figures already on screen, with
  // causes forbidden unless a source stated one. Worth revisiting if it
  // ever says something the sources didn't.
  situation?: string;
  // Set only when the user asked for news and it couldn't be delivered.
  // Absent means either news is off, or it worked.
  newsUnavailable?: "fetch_failed";
  // Same idea for the markets row, which unlike news does still need a
  // key. Distinguishing "not set up" from "couldn't fetch" is the whole
  // reason these exist: both render as a missing section otherwise, and
  // only one of them is something the user can fix.
  marketsUnavailable?: "not_configured" | "fetch_failed";
  // Never passes through Claude. These are prices, and a model has no
  // business restating a number it could get wrong when the number can
  // simply be rendered.
  markets?: MarketSnapshot;
};

const SYSTEM_PROMPT =
  "You are Nexus, a personal chief of staff. Given a user's unread email and " +
  "upcoming calendar events, produce a short morning brief. Lead with what " +
  "needs a decision or reply today. Surface real connections between an email " +
  "and a calendar event when they genuinely relate — do not force a connection " +
  "that isn't there. Be specific: name the person, the topic, the time. If " +
  "nothing is urgent, say so plainly and do not manufacture urgency. Never " +
  "invent details that aren't in the data provided. " +
  "Some events carry a prep checklist the user has already agreed to. " +
  "Unfinished items on an event happening today are the strongest signal " +
  "you have of what needs doing — treat them as commitments the user made " +
  "to themselves, lead with them where they're at risk, and attribute them " +
  "to the calendar. Do not invent prep items beyond the ones listed. " +
  "When news articles are provided you also write `situation`: two short " +
  "paragraphs, the first on markets and the second on U.S. and world " +
  "events. This is the one part of the brief you compose rather than " +
  "select, so it is held to a hard rule — every fact in it must come " +
  "from an article summary or from the quote figures given to you. " +
  "Report causes only where a source states one; if the material says " +
  "what moved but not why, say what moved. Copy figures exactly and use " +
  "no others. Six sentences total is plenty, and thin material should " +
  "produce a shorter paragraph rather than a padded one. No forecasts, " +
  "no advice, no 'what this means for you'. " +
  "If a list of news articles is provided, the user explicitly asked for " +
  "news in their brief — pick the 6 to 8 most relevant to someone in " +
  "their position and put them in newsHighlights, most significant " +
  "first. Prefer breadth: market moves, industry developments and major " +
  "headlines rather than eight variations on one story. Copy each title " +
  "EXACTLY " +
  "as given; a paraphrased title is discarded and shows the user nothing. " +
  "Never invent an article, a headline, or a market move that isn't in " +
  "the provided list, and add no commentary, analysis, or reason it " +
  "matters — selection only. Return fewer than 2 only if the list is " +
  "genuinely all irrelevant to them, which is rare when a list is " +
  "provided at all. These sit at the bottom of the brief — never the " +
  "headline, never a priority. " +
  "You also keep notes. Alongside the brief you record any durable fact " +
  "about this user that today's mail or calendar revealed and that would " +
  "help you read tomorrow's — who a person is to them, a deadline they " +
  "are working toward, a project in flight, how they like to work. Most " +
  "days this is zero to three things, and often zero: a fact that is " +
  "only true today is not a fact worth keeping, and neither is one you " +
  "were already told about them. Every note cites the message id or " +
  "event key it came from, and a note citing anything else is thrown " +
  "away.";

// How many headlines the brief can carry. Referenced by the tool schema
// and by the resolver, so the two can't drift apart.
const MAX_NEWS_HIGHLIGHTS = 8;

// Two paragraphs. The cap is a guard against a runaway response, not a
// target — the prompt asks for six sentences.
const MAX_SITUATION_CHARS = 1600;

// The brief comes back as tool input rather than prose, so the shape is
// enforced by the schema instead of parsed out of free text.
//
// newsHighlights only gets added to the schema when there's real news data
// for Claude to choose from — leaving it out entirely (rather than always
// present but empty) means a user who didn't ask for news doesn't even
// give the model the opportunity to invent something there.
function buildBriefTool(newsCount: number) {
  const includeNews = newsCount > 0;
  return {
    name: "write_brief",
    description: "Record the morning brief for the user.",
    input_schema: {
      type: "object" as const,
      properties: {
        greeting: {
          type: "string",
          description: "One line, e.g. 'Three things need you today.'",
        },
        headline: {
          type: "string",
          description: "The single most important thing, 1-2 sentences.",
        },
        priorities: {
          type: "array",
          maxItems: 5,
          description: "Up to 5 things that need the user today. May be empty.",
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "The action, short." },
              reason: {
                type: "string",
                description: "Why it matters today, specific and grounded.",
              },
              source: {
                type: "string",
                enum: ["email", "calendar", "both"],
                description: "Where this came from. Use 'both' only for a real link.",
              },
              sourceId: {
                type: "string",
                description: "Id of the originating message or event, if any.",
              },
            },
            required: ["title", "reason", "source"],
          },
        },
        scheduleNote: {
          type: "string",
          description: "One line on the shape of the day.",
        },
        // Required with a zero floor rather than optional. The news
        // field taught this: a low-effort model hands back an optional
        // array roughly never. Required-but-emptyable makes the model
        // decide rather than skip, and an empty array is the honest
        // answer most mornings.
        facts: {
          type: "array",
          maxItems: 6,
          minItems: 0,
          description:
            "Durable facts about the user learned from today's data. " +
            "Zero is the normal answer — record something only if it " +
            "would still be worth knowing next week. Never record " +
            "what is already in the notes you were given, and never " +
            "record the contents of a single email as a fact about " +
            "the person.",
          items: {
            type: "object",
            properties: {
              fact: {
                type: "string",
                description:
                  "One sentence, written about the user in the third " +
                  "person: 'Marcus is their co-founder.'",
              },
              category: {
                type: "string",
                enum: FACT_CATEGORIES as unknown as string[],
                description:
                  "person: who someone is to them. deadline: something " +
                  "with a date. project: work in flight. preference: " +
                  "how they work.",
              },
              sourceId: {
                type: "string",
                description:
                  "The id of the email, or the key of the event, this " +
                  "was read out of. Must be one you were given.",
              },
              expiresAt: {
                type: "string",
                description:
                  "ISO date after which this stops being true. Required " +
                  "in spirit for deadlines; omit for things with no " +
                  "natural end, like who someone is.",
              },
            },
            required: ["fact", "category", "sourceId"],
          },
        },
        ...(includeNews
          ? {
              newsHighlights: {
                type: "array",
                // Forced to at least one. The field was optional, and a
                // low-effort model handed an optional array it has been
                // told is "nice to have" reliably omits it altogether —
                // fifty fetched articles, zero picked, every single run.
                // A schema requirement is the only instruction of this
                // kind a model can't talk itself out of.
                // Never asks for more than there are. A pool thinned by
                // a couple of dead feeds would otherwise force the model
                // to pad — repeating titles, or inventing them, both of
                // which the resolver drops, leaving an empty section
                // with nothing to explain it.
                minItems: Math.min(4, newsCount),
                maxItems: MAX_NEWS_HIGHLIGHTS,
                description:
                  "4 to 8 titles, most significant first, chosen ONLY " +
                  "from the provided news " +
                  "articles list and copied EXACTLY as given, character " +
                  "for character — a paraphrase is dropped and the user " +
                  "sees nothing. No commentary or reasoning, selection " +
                  "only. The user asked for news, so a short list is a " +
                  "worse answer than a full one.",
                items: { type: "string" },
              },
              situation: {
                type: "string",
                description:
                  "Two short paragraphs on what is going on right now: " +
                  "one on markets, one on U.S. and world events. Write " +
                  "ONLY from the article summaries and the exact quote " +
                  "figures provided. State what happened and what the " +
                  "sources say about why — never supply a cause of your " +
                  "own. Use only the numbers given, copied exactly. If " +
                  "the material is thin, write less; do not fill space. " +
                  "No advice, no predictions, no what-this-means-for-you.",
              },
            }
          : {}),
      },
      required: [
        "greeting",
        "headline",
        "priorities",
        "scheduleNote",
        "facts",
        // Only when there are articles to choose from — buildBriefTool's
        // whole `includeNews` split exists so a user who didn't ask for
        // news is never handed a field about it.
        ...(includeNews ? ["newsHighlights", "situation"] : []),
      ],
    },
  };
}

// Today or tomorrow in *the user's* timezone. This used to compare
// against the server's day, which on a UTC host meant that from 8pm in
// New York the brief quietly shifted its window forward a day: it would
// drop the evening's remaining events and pull in the day after
// tomorrow's.
//
// All-day events need the other half of that care. Their `start` is a
// bare YYYY-MM-DD, which `new Date()` reads as UTC midnight — so
// formatting it into a zone behind UTC hands back the *previous* day,
// and an all-day event happening today matched neither key and vanished
// from the brief for everyone west of London. A bare date is already a
// calendar day; it needs comparing, not converting.
function isTodayOrTomorrow(event: EventSummary, timeZone: string): boolean {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const today = dayKey(now, timeZone);
  const next = dayKey(tomorrow, timeZone);

  if (event.allDay) {
    const day = event.start.slice(0, 10);
    return day === today || day === next;
  }

  const start = new Date(event.start);
  if (Number.isNaN(start.getTime())) return false;

  const day = dayKey(start, timeZone);
  return day === today || day === next;
}

// Narrow to exactly the four fields this checks. It used to claim
// Omit<Brief, "calendarUnavailable">, which promised a typed
// newsHighlights the tool actually returns as string[] — true today only
// because the caller re-reads that field through a cast.
function isBrief(
  value: unknown
): value is Pick<
  Brief,
  "greeting" | "headline" | "priorities" | "scheduleNote"
> {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  if (
    typeof b.greeting !== "string" ||
    typeof b.headline !== "string" ||
    typeof b.scheduleNote !== "string" ||
    !Array.isArray(b.priorities)
  ) {
    return false;
  }
  return b.priorities.every((p) => {
    if (!p || typeof p !== "object") return false;
    const item = p as Record<string, unknown>;
    return (
      typeof item.title === "string" &&
      typeof item.reason === "string" &&
      (item.source === "email" ||
        item.source === "calendar" ||
        item.source === "both") &&
      (item.sourceId === undefined || typeof item.sourceId === "string")
    );
  });
}

// Claude only ever sees article titles and is told to copy them exactly,
// but "told to" isn't a guarantee — this is the actual enforcement. Any
// returned item whose title doesn't match something we really fetched is
// dropped rather than shown, on the assumption that a model that got the
// title wrong got the rest wrong too. Matching is case/whitespace-loose
// because copying "exactly" still occasionally drops trailing punctuation.
function resolveNewsHighlights(
  raw: unknown,
  fetched: NewsArticle[]
): NewsHighlight[] {
  if (!Array.isArray(raw) || !fetched.length) return [];

  const byNormalizedTitle = new Map(
    fetched.map((article) => [normalizeTitle(article.title), article])
  );

  const resolved: NewsHighlight[] = [];
  const usedUrls = new Set<string>();
  for (const title of raw) {
    // Bounded by the schema's maxItems rather than a second number that
    // has to be kept in step with it. This used to be a hard 3, left
    // over from when the schema allowed 3 — so a model correctly picking
    // 8 had 5 silently discarded, and the log blamed title matching.
    if (resolved.length >= MAX_NEWS_HIGHLIGHTS) break;
    if (typeof title !== "string") continue;

    const article = byNormalizedTitle.get(normalizeTitle(title));
    if (!article) continue; // not something we actually fetched — drop it
    if (usedUrls.has(article.url)) continue; // Claude repeated itself
    usedUrls.add(article.url);

    resolved.push({
      title: article.title,
      source: article.source,
      url: article.url,
      category: article.category,
    });
  }
  return resolved;
}

// The model is asked to copy titles exactly, and this is the check that
// a copy really was exact. It has to forgive the things a model changes
// without meaning to — internal whitespace, trailing punctuation, curly
// quotes — while still catching an actual paraphrase.
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?\u2026"']+$/, "");
}

// A brief built while something was down is worth showing once and worth
// storing never. Cached, a 7am calendar blip would serve "your calendar
// wasn't available this morning" for the next seventeen hours, with no
// retry and no TTL — the calendar back a minute later would change
// nothing. Serving it degraded and regenerating next load is the cheaper
// mistake.
function isDegraded(brief: Brief): boolean {
  return Boolean(
    brief.calendarUnavailable ||
      brief.mailUnavailable ||
      brief.newsUnavailable ||
      brief.marketsUnavailable
  );
}

/**
 * What a caller gets back. A discriminated result rather than a thrown
 * error or an HTTP response, because there are now two callers with very
 * different ideas of what to do about a failure: a route turns it into a
 * status code, and a scheduled job turns it into "skip this user and
 * carry on".
 */
export type BriefResult =
  | { ok: true; brief: Brief; generatedAt: string; cached: boolean }
  | { ok: false; error: string; code?: string; status: number };

export type GenerateOptions = {
  // The browser's zone, used only when the profile has none. A cron has
  // no browser and passes nothing, which is correct — a scheduled brief
  // fires off the profile's timezone or not at all.
  fallbackTimezone?: string | null;
  forceRefresh?: boolean;
};

// Store, then answer. A cache write that fails is logged and ignored —
// the user gets their brief either way, they just pay for the next one.
async function storeAndReturn(
  userId: string,
  day: string,
  brief: Brief
): Promise<BriefResult> {
  if (isDegraded(brief)) {
    console.log("[brief] degraded — served without caching");
    return { ok: true, brief, generatedAt: new Date().toISOString(), cached: false };
  }

  const generatedAt =
    (await writeCachedBrief(userId, day, brief)) ?? new Date().toISOString();
  // Fire and forget: any other day's row is dead weight, and nobody
  // should wait on its removal.
  void pruneOtherDays(userId, day);
  return { ok: true, brief, generatedAt, cached: false };
}

/**
 * Build one user's brief, reading and writing the day's cache.
 *
 * Extracted from the route so a scheduled job can call it with nothing
 * but a user id. Everything a request used to supply — the timezone
 * fallback, the refresh flag — is now an option with a sane default.
 */
export async function generateBrief(
  userId: string,
  options: GenerateOptions = {}
): Promise<BriefResult> {
  let narrowedEmails: {
    id: string;
    from: string;
    fromEmail: string;
    subject: string;
    snippet: string;
    date: string;
  }[] = [];
  let narrowedEvents: EventSummary[] = [];
  let calendarUnavailable = false;
  // Mirrors calendarUnavailable: a dead Gmail token shouldn't take the
  // whole brief down when calendar alone is still enough to be useful.
  let mailUnavailable = false;
  // Unfinished prep for the events in the window, as flat lines Claude
  // can quote back — "the deck isn't sent" is exactly the kind of thing
  // a chief of staff should lead with.
  let openPrep: { event: string; start: string; todo: string[] }[] = [];

  // What the user told us about themselves at onboarding. Personalization
  // is additive — a user who skipped the interview gets exactly the brief
  // they got before this existed — so a failed read is logged and dropped
  // rather than failing the request.
  let profile: UserProfileRow | null = null;
  try {
    profile = await getProfile(userId);
  } catch (err) {
    console.error("Brief: profile unavailable", errorMessage(err));
  }

  // Everything below that asks "is this today?" has to ask it in the
  // user's zone, not the host's.
  //
  // The browser's zone is the fallback when the interview's timezone
  // question was skipped. Without it the host answers, and on a UTC host
  // that means the cache key rolls over at 5pm Pacific — an afternoon
  // load missing, paying for a fresh call, and being greeted with
  // tomorrow's "morning" brief.
  const timeZone = resolveTimezone(
    profile?.timezone ?? options.fallbackTimezone
  );

  // The cache check comes before every fetch, not just before the model
  // call — a cached brief should cost one Supabase read, not a round of
  // Gmail, Calendar, RSS and quotes whose results get thrown away.
  const today = dayKey(new Date(), timeZone);
  const forceRefresh = options.forceRefresh === true;

  if (!forceRefresh) {
    const cached = await readCachedBrief<Brief>(userId, today, isBrief);
    if (cached) {
      // Prices are the one part of a stored brief that goes stale in a
      // way the reader can't see. The prose is timestamped and stays as
      // written; the tiles get refreshed, which costs one batched quote
      // request that is itself cached for five minutes.
      let brief = cached.brief;
      if (brief.markets) {
        const fresh = await fetchMarketSnapshot(profile?.timezone ?? null);
        if (fresh) brief = { ...brief, markets: fresh };
      }

      console.log(`[brief] served from cache (written ${cached.generatedAt})`);
      return { ok: true, brief, generatedAt: cached.generatedAt, cached: true };
    }
  }

  // News is independent of the Google/Supabase fetches below — it doesn't
  // need Gmail or Calendar to be connected, so it gets its own try/catch
  // rather than living inside (or being able to fail) the mail/calendar
  // block. An empty array here just means the news section doesn't show;
  // it's never the reason the whole brief fails.
  let narrowedArticles: NewsArticle[] = [];
  let markets: MarketSnapshot | null = null;
  let newsUnavailable: Brief["newsUnavailable"];
  let marketsUnavailable: Brief["marketsUnavailable"];
  const categories = newsSelections(profile) as NewsCategory[];
  if (!categories.length) {
    console.log(
      `[news] no categories selected (stored value: ${JSON.stringify(
        profile?.news_preferences ?? null
      )})`
    );
  }
  if (categories.length) {
    // Markets only for someone who asked for financial news, and only
    // when there's a key for it. News itself needs neither — RSS has no
    // key and no quota.
    const wantsMarkets = categories.includes("financial");
    if (wantsMarkets && !isMarketsConfigured()) {
      marketsUnavailable = "not_configured";
      console.error("Brief: markets requested but TWELVE_DATA_API_KEY is not set");
    }

    try {
      const [news, snapshot] = await Promise.all([
        fetchNewsHighlights(categories, profile?.sector ?? null),
        wantsMarkets && isMarketsConfigured()
          ? fetchMarketSnapshot(profile?.timezone ?? null)
          : Promise.resolve(null),
      ]);
      narrowedArticles = news.articles;
      markets = snapshot;

      // "Nobody answered" is a failure worth telling the user about.
      // "Everyone answered and nothing was published" is not, and an
      // empty-list check couldn't tell them apart.
      if (news.feedsTried > 0 && news.feedsSucceeded === 0) {
        newsUnavailable = "fetch_failed";
      }
      if (wantsMarkets && isMarketsConfigured() && !snapshot) {
        marketsUnavailable = "fetch_failed";
      }

      console.log(
        `[news] ${news.articles.length} headlines from ` +
          `${news.feedsSucceeded}/${news.feedsTried} feeds` +
          (wantsMarkets
            ? `, markets: ${snapshot ? `${snapshot.quotes.length} quotes` : "unavailable"}`
            : "")
      );
    } catch (err) {
      newsUnavailable = "fetch_failed";
      console.error("Brief: news unavailable", errorMessage(err));
    }
  }

  try {
    const client = await getAuthorizedClientForUser(userId);
    if (!client) {
      return {
        ok: false,
        error: "Google not connected",
        code: "not_connected",
        status: 400,
      };
    }

    // Calendar is optional here in a way it isn't on its own route: a
    // brief built from email alone is still worth reading, so a calendar
    // that can't be reached gets flagged rather than failing the request.
    // gatherEvents pulls Google and Apple together — the brief sees one
    // list and never learns there are two services behind it.
    const [messagesResult, eventsResult] = await Promise.allSettled([
      fetchRecentMessages(client, MESSAGE_FETCH_LIMIT),
      gatherEvents(userId, CALENDAR_DAYS),
    ]);

    // Mail is optional here the same way calendar is: a brief built
    // from calendar alone (or neither) is still worth showing, so a
    // dead Gmail token degrades the brief instead of failing it.
    if (messagesResult.status === "rejected") {
      mailUnavailable = true;
      console.error("Brief: mail unavailable", errorMessage(messagesResult.reason));
    }

    if (eventsResult.status === "fulfilled") {
      const { events, google, apple } = eventsResult.value;
      narrowedEvents = events.filter((event) =>
        isTodayOrTomorrow(event, timeZone)
      );

      // Prep is context, not a data source: if the lookup fails the
      // brief is a little less useful, not broken.
      try {
        const items = await listPrepItems(
          userId,
          narrowedEvents.map((event) => event.key)
        );
        openPrep = narrowedEvents
          .map((event) => ({
            event: event.summary,
            start: event.start,
            todo: (items[event.key] ?? [])
              .filter((item) => !item.done)
              .map((item) => item.title),
          }))
          .filter((entry) => entry.todo.length > 0);
      } catch (err) {
        console.error("Brief: prep items unavailable", errorMessage(err));
      }

      // Only claim the calendar is unavailable when no service came
      // through. One source failing while the other works means the
      // brief is thinner than it should be, not blind.
      calendarUnavailable = google !== "ok" && apple !== "ok";
      if (calendarUnavailable) {
        console.error(
          `Brief: calendar unavailable (google: ${google}, apple: ${apple})`
        );
      }
    } else {
      calendarUnavailable = true;
      console.error(
        "Brief: calendar unavailable",
        errorMessage(eventsResult.reason)
      );
    }

    if (messagesResult.status === "fulfilled") {
      narrowedEmails = messagesResult.value
        .filter((m) => m.unread)
        .slice(0, MAX_UNREAD)
        .map((m) => ({
          id: m.id,
          from: m.from,
          fromEmail: m.fromEmail,
          subject: m.subject,
          snippet: m.snippet.slice(0, SNIPPET_CHARS),
          date: m.date,
        }));
    }
  } catch (err: unknown) {
    console.error("Brief data fetch failed", errorMessage(err));
    const code =
      typeof err === "object" && err && "code" in err
        ? (err as { code: number }).code
        : null;
    return {
      ok: false,
      error: "Failed to load your mail and calendar",
      status: code === 401 ? 401 : 500,
    };
  }

  // Nothing to summarize — say so rather than paying for a call that would
  // have to invent something. News alone still earns a real Claude call:
  // a user with an empty inbox who asked for market news should still get
  // it, rather than a "nothing urgent" brief that ignores what they asked
  // for.
  if (!narrowedEmails.length && !narrowedEvents.length && !narrowedArticles.length) {
    // The copy has to branch on whether the calendar was actually
    // readable. It used to assert "nothing on your calendar" while
    // simultaneously setting calendarUnavailable, so the card claimed an
    // empty calendar directly above a banner saying the calendar
    // couldn't be reached.
    const brief: Brief = {
      greeting: "Nothing urgent right now.",
      headline:
        calendarUnavailable && mailUnavailable
          ? "Your mail and calendar couldn't be reached, so there's nothing to show."
          : calendarUnavailable
            ? "No unread mail. Your calendar couldn't be reached, so this is your inbox only."
            : mailUnavailable
              ? "Your mail couldn't be reached. Nothing on your calendar for today or tomorrow."
              : "No unread mail and nothing on your calendar for today or tomorrow.",
      priorities: [],
      scheduleNote: calendarUnavailable
        ? "Your calendar wasn't available, so nothing here reflects your schedule."
        : "Your next two days are clear.",
      ...(calendarUnavailable ? { calendarUnavailable: true } : {}),
      ...(mailUnavailable ? { mailUnavailable: true } : {}),
      // Carried on the quiet-day brief too. This is the most likely
      // moment to hit it — an empty inbox is exactly when someone
      // notices the news they asked for isn't there.
      ...(newsUnavailable ? { newsUnavailable } : {}),
      ...(markets ? { markets } : {}),
      ...(marketsUnavailable ? { marketsUnavailable } : {}),
    };
    return storeAndReturn(userId, today, brief);
  }

  // What Nexus has learned about this user on previous days.
  //
  // The whole list is read, not just the part that goes in the prompt:
  // the selection below decides what's worth spending context on today,
  // while the full set is what stops the model re-learning the same fact
  // every morning. Both come from one query.
  let knownFacts: Fact[] = [];
  try {
    knownFacts = liveFacts(await listFacts(userId));
  } catch (err) {
    console.error("Brief: memory unavailable", errorMessage(err));
  }

  // Everything today is about, as one bag of words for the keyword match.
  const memoryContext = [
    ...narrowedEmails.map((m) => `${m.from} ${m.subject} ${m.snippet}`),
    ...narrowedEvents.map((e) => e.summary),
  ].join(" ");
  const remembered = selectFacts(knownFacts, memoryContext);

  // Which ids a new fact is allowed to cite: exactly what the model is
  // about to be shown, and nothing else.
  const factSources = new Map<
    string,
    { kind: "email" | "calendar"; label: string }
  >();
  for (const email of narrowedEmails) {
    factSources.set(email.id, { kind: "email", label: email.subject });
  }
  for (const event of narrowedEvents) {
    factSources.set(event.key, { kind: "calendar", label: event.summary });
  }

  // Claude gets its own try/catch: the mail and calendar data loaded fine, so
  // a generation failure is a smaller problem than a fetch failure and the UI
  // should be able to say "retry" rather than "something broke".
  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: BRIEF_MODEL,
      max_tokens: 4096,
      output_config: { effort: "low" },
      system:
        SYSTEM_PROMPT +
        profileToPromptContext(profile) +
        factsToPromptContext(remembered),
      tools: [buildBriefTool(narrowedArticles.length)],
      tool_choice: { type: "tool", name: "write_brief" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                ...nowLines(timeZone),
                profile?.morning_time
                  ? `They read this brief around ${profile.morning_time}. ` +
                    "Write it as if it is being read then — if the day has " +
                    "already moved past something, don't lead with it."
                  : "",
                "",
                calendarUnavailable
                  ? "Calendar data is unavailable — write the brief from email alone and do not refer to meetings."
                  : `Events today and tomorrow:\n${JSON.stringify(narrowedEvents, null, 2)}`,
                "",
                openPrep.length
                  ? `Unfinished prep for those events:\n${JSON.stringify(openPrep, null, 2)}`
                  : "No unfinished prep on those events.",
                "",
                mailUnavailable
                  ? "Email data is unavailable — write the brief from calendar alone and do not refer to unread mail."
                  : `Unread email:\n${JSON.stringify(narrowedEmails, null, 2)}`,
                "",
                narrowedArticles.length
                  ? `News articles. Pick newsHighlights titles from this ` +
                    `list by copying \`title\` exactly, and write ` +
                    `\`situation\` from the \`summary\` fields — those ` +
                    `summaries are the publishers' own words and are the ` +
                    `only account of events you have:\n` +
                    JSON.stringify(
                      narrowedArticles.map((a) => ({
                        title: a.title,
                        source: a.source,
                        category: a.category,
                        summary: a.summary,
                      })),
                      null,
                      2
                    )
                  : "No news articles available — leave newsHighlights and situation out entirely.",
                "",
                // The quote figures reach the model only so the market
                // paragraph can cite them. The tiles the user actually
                // reads are rendered from this same object server-side,
                // so a misquoted number would sit directly beside the
                // correct one — which is its own kind of check.
                markets
                  ? `Market quotes as of ${markets.fetchedAt}. Use these ` +
                    `exact figures and no others:\n` +
                    JSON.stringify(
                      markets.quotes.map((q) => ({
                        what: q.label,
                        price: q.price,
                        changePercent: Number(q.changePercent.toFixed(2)),
                      })),
                      null,
                      2
                    )
                  : "No market quotes available — do not mention index or " +
                    "asset prices in situation.",
              ].join("\n"),
            },
          ],
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use" || !isBrief(toolUse.input)) {
      throw new Error("Claude did not return a brief matching the schema");
    }

    // Rebuilt field by field rather than spread from toolUse.input — raw
    // model output could contain a newsHighlights entry that didn't
    // survive the match-against-fetched-articles check in
    // resolveNewsHighlights, and a spread would let it leak through
    // before that check ever ran.
    const rawHighlights = (toolUse.input as Record<string, unknown>)
      .newsHighlights;
    const newsHighlights = resolveNewsHighlights(
      rawHighlights,
      narrowedArticles
    );

    // Only kept when there was source material behind it. A `situation`
    // written with no articles in hand is the exact failure the rest of
    // this file is built to prevent.
    const rawSituation = (toolUse.input as Record<string, unknown>).situation;
    const situation =
      narrowedArticles.length && typeof rawSituation === "string"
        ? rawSituation.trim().slice(0, MAX_SITUATION_CHARS)
        : "";
    if (narrowedArticles.length) {
      const picked = Array.isArray(rawHighlights)
        ? `${rawHighlights.length}`
        : rawHighlights === undefined
          ? "omitted the field"
          : `unexpected ${typeof rawHighlights}`;
      console.log(
        `[news] model picked ${picked} of ${narrowedArticles.length} ` +
          `available, ${newsHighlights.length} survived title matching`
      );
    }

    // Notes, checked before they're kept: a citation to something the
    // model wasn't shown is dropped, and so is a fact already in memory.
    const learned = sanitizeExtractedFacts(
      (toolUse.input as Record<string, unknown>).facts,
      {
        sources: factSources,
        existing: knownFacts.map((fact) => normalizeFact(fact.fact)),
      }
    );
    if (learned.length) {
      const stored = await rememberFacts(userId, learned);
      console.log(
        `[memory] ${stored} new fact(s) from ${knownFacts.length} already known`
      );
    }
    // Once a day per user, which is what this route amounts to, is the
    // right cadence for a sweep — and nobody waits on it.
    void pruneExpiredFacts(userId);

    const brief: Brief = {
      greeting: toolUse.input.greeting,
      headline: toolUse.input.headline,
      priorities: toolUse.input.priorities.slice(0, 5),
      scheduleNote: toolUse.input.scheduleNote,
      ...(calendarUnavailable ? { calendarUnavailable: true } : {}),
      ...(mailUnavailable ? { mailUnavailable: true } : {}),
      ...(newsHighlights.length ? { newsHighlights } : {}),
      ...(situation ? { situation } : {}),
      ...(newsUnavailable ? { newsUnavailable } : {}),
      ...(markets ? { markets } : {}),
      ...(marketsUnavailable ? { marketsUnavailable } : {}),
    };

    return storeAndReturn(userId, today, brief);
  } catch (err: unknown) {
    console.error("Brief generation failed", errorMessage(err));
    return {
      ok: false,
      error: "Couldn't generate your brief just now.",
      code: "brief_unavailable",
      status: 503,
    };
  }
}
