// A small RSS reader.
//
// Deliberately dependency-free. Every XML library would do this better,
// but RSS 2.0's item/title/link/pubDate core is regular enough to read
// with a few expressions, and adding a parser to package.json for four
// tags is a dependency to keep patched forever.
//
// Feeds are the cheapest news source there is: no API key, no quota, no
// commercial-use clause. The cost is that each publisher formats things
// slightly differently — some CDATA-wrap titles, some entity-encode them
// — so the parsing here is defensive rather than strict.

const FETCH_TIMEOUT_MS = 6000;

export type FeedItem = {
  title: string;
  url: string;
  publishedAt: string | null;
  // The first paragraph or two of the story, stripped of markup. Headlines
  // alone are too thin to summarize from without guessing at causes —
  // "Markets slip" doesn't say why, and a model asked to explain it will
  // invent a reason. This is the substance that makes a written summary
  // grounded rather than confabulated.
  summary: string;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

// Publishers mix named entities, decimal refs and hex refs freely, often
// inside one headline. Decoding all three is less work than discovering
// which one a given feed uses.
//
// One pass, not three chained ones. Chained replaces run over each
// other's output, so `&#38;amp;` — a legitimately double-escaped
// ampersand, which WordPress and Yahoo pipelines emit routinely —
// decoded to `&` and then that `&` was re-read as the start of `&amp;`,
// yielding a single `&` instead of the literal `&amp;` the publisher
// wrote. Corrupted headlines, silently.
function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g,
    (match, hex, dec, name) => {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(Number(dec));
      return ENTITIES[name] ?? match;
    }
  );
}

// Unwraps every CDATA section rather than only a value that is entirely
// one section. A title like `<![CDATA[Foo]]> &amp; bar` is legal and used
// in the wild; anchoring on the whole string left the raw `<![CDATA[`
// markers sitting in the headline.
function stripCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function tagContent(block: string, tag: string): string | null {
  // Non-greedy, tolerant of attributes, and — the subtle part — the
  // opening tag must not be self-closing. `[^>]*` happily eats a
  // trailing slash, so `<link rel="alternate" href="..."/>` matched as
  // an opening tag and the capture ran past the real `<link>` to the
  // next `</link>`. The result failed the URL check and the article was
  // dropped, making a well-formed feed look dead.
  const match = block.match(
    new RegExp(`<${tag}(?:\\s[^>]*[^/>])?>([\\s\\S]*?)</${tag}>`, "i")
  );
  if (!match) return null;
  // Internal whitespace is collapsed because a title wrapped across
  // lines in the source XML otherwise carries the newline and indent
  // into the headline — and into the exact-title match the brief uses to
  // confirm the model didn't paraphrase.
  const value = decodeEntities(stripCdata(match[1]))
    .replace(/\s+/g, " ")
    .trim();
  return value || null;
}

// Feed descriptions are HTML: paragraph tags, tracking pixels, "Read more"
// anchors. None of that helps a model and all of it costs context.
const MAX_SUMMARY_CHARS = 400;

function toPlainText(html: string | null): string {
  if (!html) return "";
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    // Tags become spaces so words don't run together, which leaves a gap
    // before punctuation wherever a link ended a sentence: "the jobs
    // report ." Closing it here rather than not spacing at all, because
    // "reportcame" is the worse failure.
    .replace(/\s+([.,;:!?%])/g, "$1")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS);
}

function linkHref(block: string): string | null {
  const match = block.match(
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i
  );
  return match ? decodeEntities(match[1]).trim() || null : null;
}

function toIsoDate(raw: string | null): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseFeed(xml: string, limit: number): FeedItem[] {
  const items: FeedItem[] = [];

  // RSS uses <item>; Atom uses <entry>. Accepting both means a feed
  // added later doesn't fail silently as an empty list indistinguishable
  // from a dead publisher.
  const blocks = [
    ...(xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []),
    ...(xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? []),
  ];
  for (const block of blocks) {
    if (items.length >= limit) break;

    const title = tagContent(block, "title");
    // Some feeds put a tracking wrapper in <link> and the canonical URL in
    // <guid isPermaLink="true">. Either is a working link; the first one
    // present wins.
    // Atom puts the URL in <link href="..."/> rather than in the text
    // node, so fall through to the attribute before giving up.
    const url =
      tagContent(block, "link") ??
      linkHref(block) ??
      tagContent(block, "guid");
    if (!title || !url || !/^https?:\/\//i.test(url)) continue;

    items.push({
      title,
      url,
      publishedAt: toIsoDate(
        tagContent(block, "pubDate") ??
          tagContent(block, "published") ??
          tagContent(block, "updated")
      ),
      // <description> is RSS; <summary> and <content> are the Atom
      // equivalents. Whichever the publisher offers.
      summary: toPlainText(
        tagContent(block, "description") ??
          tagContent(block, "summary") ??
          tagContent(block, "content")
      ),
    });
  }

  return items;
}

/**
 * Fetch and parse one feed. Never throws — a publisher being down should
 * cost the brief that publisher's headlines and nothing else.
 */
export async function fetchFeed(
  url: string,
  limit: number
): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // Some publishers return 403 to a bare fetch. A plain identifying
      // user agent is what their robots guidance expects.
      headers: {
        "User-Agent": "Nexus/1.0 (personal morning brief; +https://localhost)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      // Feeds update on the order of minutes, and several categories can
      // share a publisher, so let the fetch layer collapse repeats.
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      console.error(`RSS: ${url} returned ${res.status}`);
      return [];
    }
    return parseFeed(await res.text(), limit);
  } catch (err) {
    console.error(
      `RSS: ${url} failed —`,
      err instanceof Error ? err.message : String(err)
    );
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
