"use client";

import { useCallback, useEffect, useState } from "react";

// Rules that send mail to Trash on arrival.
//
// The interaction is deliberately three beats and never two: describe →
// see what it catches → confirm. There is no path from typing a sentence
// to a live filter without the middle step, because this is the one
// feature that keeps running when nobody is watching.
//
// Sweeping the existing backlog is a separate checkbox rather than part
// of the same yes. Creating a rule and emptying an inbox are different
// sizes of decision and shouldn't share a button.

type Criteria = {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
};

type PreviewMessage = {
  id: string;
  from: string;
  subject: string;
  date: string;
};

type Preview = {
  query: string;
  totalEstimate: number;
  messages: PreviewMessage[];
};

type GmailFilter = {
  id: string;
  criteria: Criteria;
  trashes: boolean;
};

type Stage =
  | { kind: "idle" }
  | { kind: "previewing" }
  | {
      kind: "confirm";
      criteria: Criteria;
      label: string;
      concern: string | null;
      preview: Preview;
    }
  | { kind: "creating" }
  | {
      kind: "done";
      label: string;
      sweptCount: number;
      // Roughly how many still match after one page was moved. The
      // checkbox offers to clear "the N already in your mailbox", and
      // the sweep caps at 200 — saying nothing let someone believe the
      // backlog was gone.
      sweepRemaining: number;
      sweepActionId: string | null;
    }
  | { kind: "error"; message: string; needsReconnect: boolean };

function describe(criteria: Criteria): string {
  const parts: string[] = [];
  if (criteria.from) parts.push(`from ${criteria.from}`);
  if (criteria.to) parts.push(`to ${criteria.to}`);
  if (criteria.subject) parts.push(`subject “${criteria.subject}”`);
  if (criteria.hasAttachment) parts.push("with an attachment");
  if (criteria.query) parts.push(criteria.query);
  if (criteria.negatedQuery) parts.push(`except ${criteria.negatedQuery}`);
  return parts.join(" · ") || "everything";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function FiltersSection() {
  const [description, setDescription] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [sweepExisting, setSweepExisting] = useState(false);
  const [filters, setFilters] = useState<GmailFilter[]>([]);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);

  const loadFilters = useCallback(async () => {
    try {
      const res = await fetch("/api/gmail/filters", { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Not connected or not yet re-consented isn't an error worth a
        // red banner here — the inbox card above already says so.
        if (body?.code === "not_connected" || body?.code === "scope_missing") {
          setFilters([]);
          return;
        }
        throw new Error(body?.error ?? "Couldn't load filters");
      }
      const body = (await res.json()) as { filters: GmailFilter[] };
      setFilters(body.filters ?? []);
      setFiltersError(null);
    } catch (err) {
      setFiltersError(
        err instanceof Error ? err.message : "Couldn't load filters"
      );
    }
  }, []);

  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  async function preview() {
    if (!description.trim()) return;
    setStage({ kind: "previewing" });
    try {
      const res = await fetch("/api/gmail/filters/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStage({
          kind: "error",
          message: body?.error ?? "Couldn't preview that rule.",
          needsReconnect: body?.code === "scope_missing",
        });
        return;
      }
      setStage({
        kind: "confirm",
        criteria: body.criteria,
        label: body.label,
        concern: body.concern ?? null,
        preview: body.preview,
      });
    } catch {
      setStage({
        kind: "error",
        message: "Couldn't reach Nexus. Try again.",
        needsReconnect: false,
      });
    }
  }

  async function create(criteria: Criteria, label: string) {
    setStage({ kind: "creating" });
    try {
      const res = await fetch("/api/gmail/filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria, label, sweepExisting }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStage({
          kind: "error",
          message: body?.error ?? "Couldn't create that rule.",
          needsReconnect: body?.code === "scope_missing",
        });
        return;
      }
      setStage({
        kind: "done",
        label,
        sweptCount: body.sweptCount ?? 0,
        sweepRemaining: body.sweepRemaining ?? 0,
        sweepActionId: body.sweepActionId ?? null,
      });
      setDescription("");
      setSweepExisting(false);
      loadFilters();
    } catch {
      setStage({
        kind: "error",
        message: "Couldn't reach Nexus. Try again.",
        needsReconnect: false,
      });
    }
  }

  async function undoSweep(actionId: string) {
    setUndoing(true);
    try {
      await fetch(`/api/actions/${actionId}/undo`, { method: "POST" });
      setStage({ kind: "idle" });
    } finally {
      setUndoing(false);
    }
  }

  async function removeFilter(id: string) {
    setFilters((current) => current.filter((f) => f.id !== id));
    await fetch(`/api/gmail/filters/${id}`, { method: "DELETE" });
    loadFilters();
  }

  return (
    <section className="mt-8 w-full max-w-3xl rounded-panel border border-line bg-white p-6">
      <header>
        <h2 className="text-base font-semibold tracking-tight text-ink">Filters</h2>
        <p className="text-sm text-neutral-500">
          Describe mail you never want to see. Nexus shows you what it
          catches before anything is switched on.
        </p>
      </header>

      {(stage.kind === "idle" ||
        stage.kind === "previewing" ||
        stage.kind === "error" ||
        stage.kind === "done") && (
        <div className="mt-4">
          {stage.kind === "error" && (
            <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
              {stage.message}{" "}
              {stage.needsReconnect && (
                <a href="/api/google/connect" className="font-medium underline">
                  Reconnect Gmail
                </a>
              )}
            </p>
          )}

          {stage.kind === "done" && (
            <div className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <p>
                “{stage.label}” is on. New mail matching it goes straight to
                Trash.
              </p>
              {stage.sweptCount > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span>
                    {stage.sweptCount} existing message
                    {stage.sweptCount === 1 ? "" : "s"} moved to Trash.
                    {stage.sweepRemaining > 0 && (
                      <>
                        {" "}About {stage.sweepRemaining} more still match —
                        run this again to clear the next batch.
                      </>
                    )}
                  </span>
                  {stage.sweepActionId && (
                    <button
                      type="button"
                      onClick={() => undoSweep(stage.sweepActionId!)}
                      disabled={undoing}
                      className="font-medium underline disabled:opacity-60"
                    >
                      {undoing ? "Putting them back…" : "Undo that"}
                    </button>
                  )}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") preview();
              }}
              maxLength={300}
              placeholder="Medium newsletters, LinkedIn notifications…"
              className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm text-neutral-800 outline-none focus:border-indigo-300"
            />
            <button
              type="button"
              onClick={preview}
              disabled={stage.kind === "previewing" || !description.trim()}
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {stage.kind === "previewing" ? "Checking…" : "See what it catches"}
            </button>
          </div>
        </div>
      )}

      {stage.kind === "confirm" && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-4">
          <p className="text-sm font-medium text-neutral-900">{stage.label}</p>
          <p className="mt-0.5 font-mono text-xs text-neutral-600">
            {describe(stage.criteria)}
          </p>

          {stage.concern && (
            <p className="mt-3 rounded-xl bg-amber-100 px-2.5 py-1.5 text-xs text-amber-900">
              {stage.concern}
            </p>
          )}

          <p className="mt-3 text-xs font-medium text-neutral-700">
            {stage.preview.totalEstimate === 0
              ? "This matches nothing in your mail right now."
              : `Matches about ${stage.preview.totalEstimate} message${
                  stage.preview.totalEstimate === 1 ? "" : "s"
                } you've already received${
                  stage.preview.messages.length < stage.preview.totalEstimate
                    ? ` — ${stage.preview.messages.length} shown`
                    : ""
                }.`}
          </p>

          {stage.preview.messages.length > 0 && (
            <ul className="mt-2 max-h-48 divide-y divide-line-soft overflow-y-auto rounded-xl border border-line bg-white">
              {stage.preview.messages.map((msg) => (
                <li key={msg.id} className="px-3 py-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-xs font-medium text-neutral-700">
                      {msg.from}
                    </p>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {formatDate(msg.date)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-neutral-500">
                    {msg.subject}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-3 flex items-start gap-2 text-xs text-neutral-700">
            <input
              type="checkbox"
              checked={sweepExisting}
              onChange={(e) => setSweepExisting(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Also move the {stage.preview.totalEstimate} already in my mailbox
              to Trash. Without this, the rule only affects mail that arrives
              from now on.
            </span>
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => create(stage.criteria, stage.label)}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Turn it on
            </button>
            <button
              type="button"
              onClick={() => {
                setStage({ kind: "idle" });
                setSweepExisting(false);
              }}
              className="rounded-full border border-line bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-surface-soft"
            >
              Cancel
            </button>
            <span className="text-xs text-neutral-500">
              Trash, not deleted — Gmail keeps it 30 days.
            </span>
          </div>
        </div>
      )}

      {stage.kind === "creating" && (
        <p className="mt-4 text-sm text-neutral-500">Setting it up…</p>
      )}

      <div className="mt-6 border-t border-line-soft pt-4">
        <h3 className="text-sm font-medium text-neutral-900">Active rules</h3>
        {filtersError && (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">
            {filtersError}
          </p>
        )}
        {filters.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">
            No filters yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line-soft">
            {filters.map((filter) => (
              <li
                key={filter.id}
                className="flex items-start justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-neutral-700">
                    {describe(filter.criteria)}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {filter.trashes ? "Sends to Trash" : "Labels or sorts"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeFilter(filter.id)}
                  className="shrink-0 text-xs text-neutral-500 underline-offset-2 hover:underline"
                >
                  Turn off
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
