// The market snapshot at the top of the brief: a fixed watchlist, priced.
//
// Separate from lib/news.ts on purpose. News is prose that Claude reads
// and selects from; this is a table of facts that goes straight to the
// page without passing through a model at all. Nothing here can be
// hallucinated because nothing here is generated — the same reasoning
// that keeps news highlights to bare headlines, applied harder.
//
// This was Alpha Vantage, one request per symbol against a 25-a-day
// quota: seven symbols meant three dashboard loads exhausted the day, and
// the file was mostly machinery for rationing — serialized requests a
// second apart, an hour-long cache, stale-on-failure. Twelve Data takes
// every symbol in ONE request, so all of that machinery is gone. The
// budget went from "three snapshots a day" to roughly a hundred.

import { resolveTimezone } from "./clock";

const TWELVE_DATA_URL = "https://api.twelvedata.com/quote";

const FETCH_TIMEOUT_MS = 8000;

// Twelve Data bills one credit per symbol, so a snapshot is 7 of 800 a
// day. The cache exists now to keep a page refresh from re-billing, not
// to ration a scarce resource — which is why it's minutes rather than an
// hour, and why prices are near-live again.
const CACHE_TTL_MS = 5 * 60 * 1000;

// Index and commodity exposure via the most liquid tracker for each. The
// label is what the user reads — nobody wants to decode "IWM".
const WATCHLIST: { symbol: string; label: string }[] = [
  { symbol: "SPY", label: "S&P 500" },
  { symbol: "QQQ", label: "Nasdaq 100" },
  { symbol: "IWM", label: "Russell 2000" },
  { symbol: "EFA", label: "Intl developed" },
  { symbol: "GLD", label: "Gold" },
  { symbol: "USO", label: "Crude oil" },
  { symbol: "BTC/USD", label: "Bitcoin" },
];

export type Quote = {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePercent: number;
};

export type MarketSnapshot = {
  quotes: Quote[];
  // When these prices were actually fetched. Rendered once they're old
  // enough to matter — the difference between "live" and "this morning"
  // is the user's to judge, not ours to hide.
  fetchedAt: string;
};

// Keyed by timezone: `change` and `percent_change` are measured against
// the previous close *in the requested zone*, so a snapshot fetched for
// New York is not the same answer as one fetched for Tokyo. A single
// global slot would serve one user's day boundary to another's brief.
const cache = new Map<string, { at: number; snapshot: MarketSnapshot }>();

export function isMarketsConfigured(): boolean {
  return Boolean(process.env.TWELVE_DATA_API_KEY);
}

function toNumber(value: unknown): number | null {
  // The empty check is load-bearing: Number("") is 0, not NaN, so a row
  // missing `close` or `percent_change` would sail past a Number.isFinite
  // guard and render as a confident $0.00 / 0.00% — a fabricated price in
  // the one file whose entire premise is that nothing here is generated.
  const cleaned = String(value ?? "").replace(/[%$,]/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// A single-symbol request returns the quote object directly; a
// multi-symbol request returns an object keyed by symbol. Normalizing
// both here means the watchlist can shrink to one entry without the
// caller learning about it.
function rowsFrom(
  body: Record<string, unknown>
): Record<string, Record<string, unknown>> {
  if (typeof body.symbol === "string") {
    return { [body.symbol]: body };
  }
  const rows: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value && typeof value === "object") {
      rows[key] = value as Record<string, unknown>;
    }
  }
  return rows;
}

function toQuote(
  symbol: string,
  label: string,
  row: Record<string, unknown> | undefined
): Quote | null {
  if (!row) return null;
  // A per-symbol failure comes back as a status field on that symbol's
  // row rather than an HTTP error, so one bad ticker doesn't fail the
  // batch — it just drops out of the snapshot.
  if (row.status === "error") {
    console.error(`Markets: ${symbol} —`, row.message ?? "unknown error");
    return null;
  }

  const price = toNumber(row.close);
  const change = toNumber(row.change);
  const changePercent = toNumber(row.percent_change);
  if (price === null || change === null || changePercent === null) return null;

  return { symbol, label, price, change, changePercent };
}

/**
 * The watchlist, priced, in one request. Returns null when there's
 * nothing to show — an unavailable snapshot costs the user a section,
 * never the brief.
 */
export async function fetchMarketSnapshot(
  timezone?: string | null
): Promise<MarketSnapshot | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;

  const zone = resolveTimezone(timezone);
  const cached = cache.get(zone);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.snapshot;
  }

  const params = new URLSearchParams({
    symbol: WATCHLIST.map((entry) => entry.symbol).join(","),
    apikey: apiKey,
    // Change figures are computed against the previous close in this
    // zone, so a user in New York doesn't read a day's move measured
    // against a UTC boundary.
    timezone: zone,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${TWELVE_DATA_URL}?${params.toString()}`, {
      signal: controller.signal,
      next: { revalidate: 300 },
    });
    if (!res.ok) {
      console.error(`Markets: Twelve Data returned ${res.status}`);
      return cached?.snapshot ?? null;
    }

    const body = (await res.json()) as Record<string, unknown>;

    // A whole-request failure (bad key, quota gone) comes back as a
    // top-level status/code pair with a 200.
    if (body.status === "error") {
      console.error("Markets: Twelve Data —", body.message ?? "unknown error");
      return cached?.snapshot ?? null;
    }

    const rows = rowsFrom(body);
    const quotes = WATCHLIST.map(({ symbol, label }) =>
      toQuote(symbol, label, rows[symbol])
    ).filter((quote): quote is Quote => quote !== null);

    // A partial snapshot is still worth showing — five of seven symbols
    // is a useful morning glance.
    if (!quotes.length) return cached?.snapshot ?? null;

    const snapshot: MarketSnapshot = {
      quotes,
      fetchedAt: new Date().toISOString(),
    };
    cache.set(zone, { at: Date.now(), snapshot });
    return snapshot;
  } catch (err) {
    console.error(
      "Markets: fetch failed",
      err instanceof Error ? err.message : String(err)
    );
    return cached?.snapshot ?? null;
  } finally {
    clearTimeout(timeout);
  }
}
