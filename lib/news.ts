// News highlights for the brief, sourced from publisher RSS feeds.
//
// This used to call Alpha Vantage's NEWS_SENTIMENT endpoint, which cost
// an API request per category against a 25-a-day quota — the single
// tightest constraint in the app. Feeds cost nothing: no key, no quota,
// no per-minute limit, and no clause about commercial use, which matters
// because every free market-data tier forbids exactly the thing Nexus is
// meant to become.
//
// What was given up: Alpha Vantage's sentiment scores and topic
// classification. Neither reached the user — the brief only ever showed
// a headline, a source and a link, because a model restating what an
// article says can restate it wrong. Losing metadata nothing rendered is
// not much of a loss.

import { fetchFeed } from "./rss";

export type NewsCategory = "financial" | "industry" | "us" | "world";

export type NewsArticle = {
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string | null;
  category: NewsCategory;
};

type Feed = { url: string; source: string };

type NewsCategoryList = NewsCategory[];

const FINANCIAL_FEEDS: Feed[] = [
  {
    url: "https://feeds.content.dowjones.io/public/rss/mw_topstories",
    source: "MarketWatch",
  },
  { url: "https://finance.yahoo.com/news/rssindex", source: "Yahoo Finance" },
];

// Domestic. NPR's National section is the closest thing to a wire feed
// for U.S. news that publishes a clean, stable RSS endpoint.
const US_FEEDS: Feed[] = [
  { url: "https://feeds.npr.org/1003/rss.xml", source: "NPR" },
];

// International. BBC World rather than BBC News: the latter leads with
// U.K. domestic stories, which is somebody's world news but not the
// user's.
const WORLD_FEEDS: Feed[] = [
  { url: "https://feeds.bbci.co.uk/news/world/rss.xml", source: "BBC World" },
];

// One feed per sector the onboarding interview offers. Sectors without an
// obvious general-interest publication map to null and fall through to
// general headlines — the same treatment "no sector set" gets, and better
// than pointing someone at a trade publication that isn't theirs.
const SECTOR_FEEDS: Record<string, Feed | null> = {
  tech: { url: "https://techcrunch.com/feed/", source: "TechCrunch" },
  finance: {
    url: "https://feeds.content.dowjones.io/public/rss/mw_marketpulse",
    source: "MarketWatch",
  },
  medicine: { url: "https://www.statnews.com/feed/", source: "STAT" },
  real_estate: {
    url: "https://www.housingwire.com/feed/",
    source: "HousingWire",
  },
  law: { url: "https://www.abajournal.com/feed", source: "ABA Journal" },
  education: {
    url: "https://www.edsurge.com/articles_rss",
    source: "EdSurge",
  },
  consulting: null,
  other: null,
};

// Per feed. The brief picks 6-8 from the pool, so this only has to be
// comfortably larger than that across all feeds.
const PER_FEED_LIMIT = 15;

function feedsFor(category: NewsCategory, sector: string | null): Feed[] {
  if (category === "financial") return FINANCIAL_FEEDS;
  if (category === "us") return US_FEEDS;
  if (category === "world") return WORLD_FEEDS;
  // Industry, with no sector or an unmapped one, has nothing specific to
  // fetch. It falls back to domestic headlines, and the URL-level dedupe
  // below collapses it against "U.S. news" if that was also picked —
  // rather than fetching the same feed twice and labelling it wrongly.
  const feed = sector ? SECTOR_FEEDS[sector] ?? null : null;
  return feed ? [feed] : US_FEEDS;
}

export type NewsResult = {
  articles: NewsArticle[];
  // How many feeds were asked, and how many answered with at least one
  // item. The caller needs both to tell "nothing was published" from
  // "nobody answered" — fetchFeed never throws, so an exception is not
  // available as a signal, and an empty list on its own means neither.
  feedsTried: number;
  feedsSucceeded: number;
};

/**
 * Headlines for the selected categories, newest first, deduplicated.
 */
export async function fetchNewsHighlights(
  categories: NewsCategory[],
  sector: string | null
): Promise<NewsResult> {
  if (!categories.length) {
    return { articles: [], feedsTried: 0, feedsSucceeded: 0 };
  }

  // One fetch per distinct feed, whatever the category overlap. Two
  // categories resolving to the same publisher is common — "industry"
  // with no sector falls back to the U.S. feed — and fetching it twice
  // would just make the dedupe below do more work.
  //
  // The category is resolved separately from the URL. Collapsing both
  // together stamped the *first* category onto a shared feed, so a user
  // who picked industry and general with no sector set saw every BBC
  // headline labelled "Industry" and nothing labelled "News". The label
  // is user-visible, so the most general category wins a tie: a feed
  // reached by both routes is a general feed that industry fell back to.
  const planned = new Map<string, { feed: Feed; categories: NewsCategory[] }>();
  for (const category of categories) {
    for (const feed of feedsFor(category, sector)) {
      const existing = planned.get(feed.url);
      if (existing) {
        if (!existing.categories.includes(category)) {
          existing.categories.push(category);
        }
      } else {
        planned.set(feed.url, { feed, categories: [category] });
      }
    }
  }

  // When one feed is reached by several categories, the broadest label
  // wins — a feed that "industry" only fell back to is a U.S. or world
  // feed, and labelling BBC World as "Industry" is the bug this replaced.
  const labelFor = (candidates: NewsCategoryList): NewsCategory => {
    for (const preferred of ["world", "us", "financial"] as const) {
      if (candidates.includes(preferred)) return preferred;
    }
    return candidates[0];
  };

  const results = await Promise.allSettled(
    Array.from(planned.values()).map(async ({ feed, categories: reached }) => {
      const category = labelFor(reached);
      const items = await fetchFeed(feed.url, PER_FEED_LIMIT);
      return items.map(
        (item): NewsArticle => ({
          title: item.title,
          source: feed.source,
          url: item.url,
          // The story's own first paragraph, not a generated one. This
          // is what a written market/world summary gets to reason from —
          // without it, a model has only headlines and fills the gaps
          // with plausible invention.
          summary: item.summary,
          publishedAt: item.publishedAt,
          category,
        })
      );
    })
  );

  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  let feedsSucceeded = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    if (result.value.length) feedsSucceeded += 1;
    for (const article of result.value) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
    }
  }

  // Newest first, so a model picking the top of a long list picks today's
  // news rather than whatever a publisher happened to order first.
  articles.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));

  return { articles, feedsTried: planned.size, feedsSucceeded };
}
