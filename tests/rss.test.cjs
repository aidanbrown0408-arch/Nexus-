const test = require("node:test");
const assert = require("node:assert/strict");
const { parseFeed } = require("../.test-build/lib/rss.js");

// Every case here is a shape a real publisher emits. The parser is
// hand-rolled — RSS is regular enough for a few expressions and adding an
// XML library for four tags is a dependency to keep patched forever — so
// these are what stand in for that library's own test suite.
const feed = (items) => `<rss version="2.0"><channel>${items}</channel></rss>`;

test("keeps well-formed items and drops unusable ones", () => {
  const items = parseFeed(
    feed(`
      <item><title>Good</title><link>https://e.com/a</link></item>
      <item><title>No link at all</title></item>
      <item><title>Relative link</title><link>/nope</link></item>
    `),
    10
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://e.com/a");
});

test("decodes entities in a single pass", () => {
  // Chained replaces ran over each other's output, so a legitimately
  // double-escaped ampersand collapsed to one — silent corruption of any
  // headline from a WordPress or Yahoo pipeline.
  const items = parseFeed(
    feed(`<item><title>AT&#38;amp;T earnings</title><link>https://e.com/1</link></item>`),
    5
  );
  assert.equal(items[0].title, "AT&amp;T earnings");
});

test("unwraps CDATA even when it is only part of the value", () => {
  const items = parseFeed(
    feed(`<item><title><![CDATA[Foo]]> &amp; bar</title><link>https://e.com/2</link></item>`),
    5
  );
  assert.equal(items[0].title, "Foo & bar");
});

test("a self-closing link does not swallow the real one", () => {
  // `[^>]*` happily eats a trailing slash, so the capture ran past the
  // real <link> and the article was dropped — a healthy feed looked dead.
  const items = parseFeed(
    feed(`<item><title>T</title><link rel="alternate" href="https://wrong.com/x"/><link>https://right.com/s</link></item>`),
    5
  );
  assert.equal(items[0].url, "https://right.com/s");
});

test("collapses whitespace in a title wrapped across lines", () => {
  // The brief confirms the model copied a headline exactly; a stray
  // newline in the source made every such title fail that check.
  const items = parseFeed(
    feed(`<item><title>\n   Treasury yields\n   slip\n </title><link>https://e.com/3</link></item>`),
    5
  );
  assert.equal(items[0].title, "Treasury yields slip");
});

test("falls back to guid when there is no link", () => {
  const items = parseFeed(
    feed(`<item><title>G</title><guid isPermaLink="true">https://e.com/d</guid></item>`),
    5
  );
  assert.equal(items[0].url, "https://e.com/d");
});

test("reads Atom entries, not just RSS items", () => {
  const items = parseFeed(
    `<feed><entry><title>Atom story</title><link rel="alternate" href="https://a.com/1"/><published>2026-08-18T12:00:00Z</published></entry></feed>`,
    5
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://a.com/1");
  assert.equal(items[0].publishedAt, "2026-08-18T12:00:00.000Z");
});

test("strips markup and tracking out of a description", () => {
  const items = parseFeed(
    feed(`<item><title>T</title><link>https://e.com/4</link><description><![CDATA[<p>Yields fell after the <a href="/x">jobs report</a>.</p><img src="p.gif"/>]]></description></item>`),
    5
  );
  assert.equal(items[0].summary, "Yields fell after the jobs report.");
});

test("parses pubDate to ISO and respects the limit", () => {
  const xml = feed(`
    <item><title>A</title><link>https://e.com/5</link><pubDate>Tue, 18 Aug 2026 21:30:56 GMT</pubDate></item>
    <item><title>B</title><link>https://e.com/6</link></item>
  `);
  assert.equal(parseFeed(xml, 10)[0].publishedAt, "2026-08-18T21:30:56.000Z");
  assert.equal(parseFeed(xml, 1).length, 1);
});
