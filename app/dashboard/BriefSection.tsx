"use client";

import { useCallback, useEffect, useState } from "react";

type Priority = {
  title: string;
  reason: string;
  source: "email" | "calendar" | "both";
  sourceId?: string;
};

// No editorial line here on purpose — see the comment on NewsHighlight in
// app/api/brief/route.ts. Title, source, and URL are all real data
// straight from the fetched article; nothing about this item is written
// by a model.
type NewsHighlight = {
  title: string;
  source: string;
  url: string;
  category: "financial" | "industry" | "us" | "world";
};

type Brief = {
  greeting: string;
  headline: string;
  priorities: Priority[];
  scheduleNote: string;
  calendarUnavailable?: boolean;
  newsHighlights?: NewsHighlight[];
  situation?: string;
  newsUnavailable?: "fetch_failed";
  marketsUnavailable?: "not_configured" | "fetch_failed";
  markets?: MarketSnapshot;
};

type Quote = {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
};

type MarketSnapshot = {
  quotes: Quote[];
  fetchedAt: string;
};

const NEWS_CATEGORY_LABEL: Record<NewsHighlight["category"], string> = {
  financial: "Markets",
  industry: "Industry",
  us: "U.S.",
  world: "World",
};

// Direction is carried by the arrow and the sign, not by the color alone.
// Red and green are the two hues a colorblind reader is least likely to
// separate, and this is a row made entirely of red and green numbers —
// so the glyph does the work and the color reinforces it.
function QuoteTile({ quote }: { quote: Quote }) {
  const down = quote.changePercent < 0;
  const flat = quote.changePercent === 0;
  const arrow = flat ? "–" : down ? "▼" : "▲";
  const tone = flat
    ? "text-neutral-500"
    : down
      ? "text-rose-700"
      : "text-emerald-700";

  // Bitcoin is five digits and the ETFs are three; whole dollars keeps
  // the row from turning into a column of decimals nobody reads.
  const price =
    quote.price >= 1000
      ? Math.round(quote.price).toLocaleString("en-US")
      : quote.price.toFixed(2);

  return (
    <div className="min-w-[104px]">
      <p className="text-[11px] uppercase tracking-wide text-neutral-400">
        {quote.label}
      </p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-neutral-800">
        ${price}
      </p>
      <p className={`text-xs font-medium tabular-nums ${tone}`}>
        {arrow} {quote.changePercent > 0 ? "+" : ""}
        {quote.changePercent.toFixed(2)}%
      </p>
    </div>
  );
}

// Only shown once the numbers are old enough for it to matter. A
// timestamp on live prices is noise; a timestamp on prices from three
// hours ago is the whole story.
function snapshotAge(fetchedAt: string): string | null {
  const at = new Date(fetchedAt);
  if (Number.isNaN(at.getTime())) return null;
  const minutes = Math.floor((Date.now() - at.getTime()) / 60000);
  if (minutes < 20) return null;
  if (minutes < 120) return `as of ${minutes} minutes ago`;
  // Past a day, a bare clock time reads as today — "as of 4:31 PM" for
  // prices from yesterday afternoon is worse than no label at all.
  if (minutes < 24 * 60) {
    return `as of ${at.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }
  return `as of ${at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

type Status =
  | { kind: "loading" }
  | { kind: "disconnected" }
  | { kind: "error"; message: string }
  | { kind: "ready"; brief: Brief };

const SOURCE_LABEL: Record<Priority["source"], string> = {
  email: "Email",
  calendar: "Calendar",
  both: "Email + Calendar",
};

export default function BriefSection() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const fetchBrief = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/brief", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "not_connected") {
          setStatus({ kind: "disconnected" });
          return;
        }
        throw new Error(body?.error ?? "Failed to load your brief");
      }
      const body = (await res.json()) as { brief: Brief };
      setStatus({ kind: "ready", brief: body.brief });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Failed to load your brief",
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  const connectHref = "/api/google/connect";

  return (
    <section className="mt-8 w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900">
            Morning Brief
          </h2>
          <p className="text-sm text-neutral-500">
            What needs you today, across mail and calendar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {status.kind === "ready" && (
            <button
              type="button"
              onClick={fetchBrief}
              disabled={refreshing}
              className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
          {status.kind === "disconnected" && (
            <a
              href={connectHref}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Connect Google
            </a>
          )}
          {status.kind === "error" && (
            <button
              type="button"
              onClick={fetchBrief}
              disabled={refreshing}
              className="rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing ? "Retrying…" : "Retry"}
            </button>
          )}
        </div>
      </header>

      <div className="mt-4">
        {status.kind === "loading" && <BriefSkeleton />}

        {status.kind === "error" && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {status.message}
          </p>
        )}

        {status.kind === "disconnected" && (
          <p className="text-sm text-neutral-500">
            Connect your Google account and your brief will appear here each
            morning.
          </p>
        )}

        {status.kind === "ready" && (
          <>
            <p className="text-base font-semibold text-neutral-900">
              {status.brief.greeting}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-neutral-700">
              {status.brief.headline}
            </p>

            {status.brief.calendarUnavailable && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Based on your email only — your calendar wasn&apos;t available
                this morning.
              </p>
            )}

            {status.brief.priorities.length > 0 && (
              <ul className="mt-4 divide-y divide-neutral-100 border-t border-neutral-100">
                {status.brief.priorities.map((priority, i) => (
                  <li key={priority.sourceId ?? i} className="py-3">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-medium text-neutral-900">
                            {priority.title}
                          </p>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {SOURCE_LABEL[priority.source]}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm leading-relaxed text-neutral-600">
                          {priority.reason}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {status.brief.scheduleNote && (
              <p className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                {status.brief.scheduleNote}
              </p>
            )}

            {/* Only ever shown to someone who asked for these, so each
                can be specific about what to do rather than hedging.
                Silence was the original bug: a ticked box and no section
                looks exactly like a setting that didn't save. */}
            {status.brief.marketsUnavailable === "not_configured" && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Market prices need a data key — set{" "}
                <code className="font-mono">TWELVE_DATA_API_KEY</code> in your
                environment and restart. Headlines below are unaffected.
              </p>
            )}

            {status.brief.marketsUnavailable === "fetch_failed" && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Couldn&apos;t reach the market data source. The rest of your
                brief is unaffected.
              </p>
            )}

            {status.brief.newsUnavailable === "fetch_failed" && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Couldn&apos;t reach the news feeds this morning. The rest of
                your brief is unaffected.
              </p>
            )}

            {status.brief.markets && status.brief.markets.quotes.length > 0 && (
              <div className="mt-4 border-t border-neutral-100 pt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                    Markets
                  </p>
                  {(() => {
                    // Read the clock once. Called twice, the two calls
                    // could straddle the 20- or 120-minute boundary and
                    // disagree about what they're rendering.
                    const age = snapshotAge(status.brief.markets.fetchedAt);
                    return age ? (
                      <p className="text-[11px] text-neutral-400">{age}</p>
                    ) : null;
                  })()}
                </div>
                {/* Numbers straight from the source — these never pass
                    through the model, so nothing here can be misstated. */}
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-3">
                  {status.brief.markets.quotes.map((quote) => (
                    <QuoteTile key={quote.symbol} quote={quote} />
                  ))}
                </div>
              </div>
            )}

            {status.brief.situation && (
              <div className="mt-4 border-t border-neutral-100 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  What&apos;s going on
                </p>
                {/* Split on blank lines so the markets paragraph and the
                    world paragraph read as two, which is how they were
                    asked for. A single-paragraph answer still renders
                    correctly as one. */}
                <div className="mt-2 space-y-2">
                  {status.brief.situation
                    .split(/\n\s*\n/)
                    .map((paragraph) => paragraph.trim())
                    .filter(Boolean)
                    .map((paragraph, i) => (
                      <p
                        key={i}
                        className="text-sm leading-relaxed text-neutral-600"
                      >
                        {paragraph}
                      </p>
                    ))}
                </div>
              </div>
            )}

            {status.brief.newsHighlights && status.brief.newsHighlights.length > 0 && (
              <div className="mt-4 border-t border-neutral-100 pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                  Headlines
                </p>
                <ul className="mt-2 space-y-2">
                  {status.brief.newsHighlights.map((item) => (
                    <li key={item.url} className="flex items-baseline gap-2">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-neutral-700 hover:text-indigo-700 hover:underline"
                      >
                        {item.title}
                      </a>
                      <span className="shrink-0 text-xs text-neutral-400">
                        {NEWS_CATEGORY_LABEL[item.category]}, {item.source}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function BriefSkeleton() {
  return (
    <div>
      <div className="h-4 w-2/5 animate-pulse rounded bg-neutral-100" />
      <div className="mt-2 space-y-2">
        <div className="h-3 w-full animate-pulse rounded bg-neutral-100" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-neutral-100" />
      </div>
      <ul className="mt-4 divide-y divide-neutral-100 border-t border-neutral-100">
        {Array.from({ length: 3 }).map((_, i) => (
          <li key={i} className="py-3">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-neutral-200" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-1/2 animate-pulse rounded bg-neutral-100" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" />
              </div>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 h-3 w-1/3 animate-pulse rounded bg-neutral-100" />
    </div>
  );
}
