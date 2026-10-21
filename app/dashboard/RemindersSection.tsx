"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PrepTodo } from "@/lib/prep";
import {
  dueBucket,
  effectiveDueDate,
  DUE_BUCKET_ORDER,
  type DueBucket,
} from "@/lib/event-days";

// Everything that needs to be done, as one list.
//
// Two kinds of row live here and the whole design turns on refusing to
// separate them. A prep item hangs off a meeting ("print the deck"); a
// task hangs off nothing ("call the dentist"). Grouping by event would put
// the dentist in a bin of his own and bury Thursday's overdue item under
// next week's — so the grouping is by *when*, and the event a row came
// from is a caption on it rather than a heading over it.
//
// The date a row sorts and groups by is `dueAt ?? eventStart`. Both that
// rule and the bucketing live in lib/event-days, shared with the tab
// badge and covered by tests/due-buckets.test.cjs — the server has the
// same rule in lib/prep's effectiveDate(), and they have to agree.

type Status =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

const BUCKET_LABEL: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  undated: "No date",
};

function timeLabel(when: string): string {
  const date = new Date(when);
  // Midnight almost always means an all-day event, or a date picked with
  // no time on it, rather than something genuinely at 12am — and printing
  // "12:00 AM" next to it reads as a bug.
  if (date.getHours() === 0 && date.getMinutes() === 0) return "";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateLabel(when: string): string {
  return new Date(when).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// The caption on the right of a row: enough to place it without repeating
// the heading it already sits under.
//
// For an event item that's the meeting's name — the thing that makes
// "print the deck" mean something. For a standalone one it's the source,
// if the row didn't come from the user typing it. Inside Today and
// Tomorrow the date is redundant and only the time survives.
function captionFor(item: PrepTodo, bucket: DueBucket): string {
  const when = effectiveDueDate(item);
  const dated = when && !Number.isNaN(new Date(when).getTime());

  const timing = !dated
    ? ""
    : bucket === "today" || bucket === "tomorrow"
      ? timeLabel(when as string)
      : [dateLabel(when as string), timeLabel(when as string)]
          .filter(Boolean)
          .join(", ");

  const context =
    item.eventSummary ??
    (item.source === "email"
      ? "From email"
      : item.source === "chat"
        ? "Added by Nexus"
        : "");

  return [context, timing].filter(Boolean).join(" · ");
}

// --- the add box --------------------------------------------------------

type DueChoice = "none" | "today" | "tomorrow" | "date";

// Local noon, not midnight. A date turned into an ISO instant at midnight
// lands on the previous day for anyone west of UTC, which would file
// "tomorrow" under Today — the one bug in a to-do list nobody forgives.
function atNoon(date: Date): string {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

function resolveDue(choice: DueChoice, typed: string): string | null {
  if (choice === "none") return null;
  if (choice === "today") return atNoon(new Date());
  if (choice === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return atNoon(d);
  }
  if (!typed) return null;
  // A yyyy-mm-dd from <input type="date"> parses as UTC midnight, so it's
  // rebuilt in local time rather than passed through.
  const [y, m, day] = typed.split("-").map(Number);
  if (!y || !m || !day) return null;
  return atNoon(new Date(y, m - 1, day));
}

export default function RemindersSection({
  variant = "panel",
}: {
  // "page" is the full-width tab; "panel" is the narrow column inside the
  // calendar card. Only spacing and the add row's layout differ — the
  // list itself is the same either way.
  variant?: "panel" | "page";
} = {}) {
  const [items, setItems] = useState<PrepTodo[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const [draft, setDraft] = useState("");
  const [due, setDue] = useState<DueChoice>("none");
  const [typedDate, setTypedDate] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (includeDone: boolean) => {
    try {
      const res = await fetch(
        `/api/prep/items${includeDone ? "?done=1" : ""}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't load your reminders");
      }
      const body = (await res.json()) as { items: PrepTodo[] };
      setItems(body.items ?? []);
      setStatus({ kind: "ready" });
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error ? err.message : "Couldn't load your reminders",
      });
    }
  }, []);

  useEffect(() => {
    load(showDone);
  }, [load, showDone]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (!title || adding) return;

    setAdding(true);
    try {
      const res = await fetch("/api/prep/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueAt: resolveDue(due, typedDate) }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't add that");
      }
      const body = (await res.json()) as { item: PrepTodo };

      // Inserted from the response rather than optimistically: the row
      // needs the id the server assigned before its checkbox can be
      // ticked, and adding is a single deliberate act, not a burst.
      setItems((current) => [...current, body.item]);
      setDraft("");
      setDue("none");
      setTypedDate("");
      setStatus({ kind: "ready" });
      inputRef.current?.focus();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Couldn't add that",
      });
    } finally {
      setAdding(false);
    }
  }

  // Tick optimistically and put it back if the write fails. A checkbox
  // that waits on a round trip before moving feels broken, and this is the
  // one interaction people do in a burst.
  async function toggle(item: PrepTodo) {
    const next = !item.done;
    setBusy((current) => new Set(current).add(item.id));
    setItems((current) =>
      current.map((i) => (i.id === item.id ? { ...i, done: next } : i))
    );

    try {
      const res = await fetch(`/api/prep/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: next }),
      });
      if (!res.ok) throw new Error("write failed");

      // Ticking something off while completed items are hidden should make
      // it leave the list, but not mid-click — the row stays until the
      // next load so a mistaken tick can be undone where it happened.
    } catch {
      setItems((current) =>
        current.map((i) => (i.id === item.id ? { ...i, done: !next } : i))
      );
      setStatus({
        kind: "error",
        message: "Couldn't save that. Check your connection and try again.",
      });
    } finally {
      setBusy((current) => {
        const copy = new Set(current);
        copy.delete(item.id);
        return copy;
      });
    }
  }

  async function remove(item: PrepTodo) {
    const previous = items;
    setItems((current) => current.filter((i) => i.id !== item.id));
    try {
      const res = await fetch(`/api/prep/items/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      setItems(previous);
      setStatus({ kind: "error", message: "Couldn't remove that one." });
    }
  }

  // One flat pass into date buckets. The server already sorted by
  // effective date, so each bucket keeps that order without re-sorting.
  const buckets = useMemo(() => {
    const grouped = new Map<DueBucket, PrepTodo[]>();
    for (const item of items) {
      const bucket = dueBucket(effectiveDueDate(item));
      const list = grouped.get(bucket);
      if (list) list.push(item);
      else grouped.set(bucket, [item]);
    }
    return DUE_BUCKET_ORDER.filter((b) => grouped.get(b)?.length).map((b) => ({
      bucket: b,
      items: grouped.get(b) ?? [],
    }));
  }, [items]);

  const openCount = items.filter((i) => !i.done).length;
  const overdueCount = items.filter(
    (i) => !i.done && dueBucket(effectiveDueDate(i)) === "overdue"
  ).length;

  const page = variant === "page";

  return (
    <div className={page ? "nx-board-body" : "nx-board-body mt-3"}>
      <form
        onSubmit={add}
        className={`mb-4 flex gap-2 ${page ? "items-center" : "flex-col"}`}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add something to do…"
          maxLength={200}
          aria-label="New reminder"
          className="nx-input !py-2 flex-1"
        />
        <div className="flex items-center gap-2">
          <div role="group" aria-label="When it's due" className="nx-segment">
            {(["none", "today", "tomorrow", "date"] as const).map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setDue(choice)}
                aria-pressed={due === choice}
                data-active={due === choice}
                className="!px-3 !py-1 !text-[12px]"
              >
                {choice === "none"
                  ? "No date"
                  : choice === "today"
                    ? "Today"
                    : choice === "tomorrow"
                      ? "Tomorrow"
                      : "Pick"}
              </button>
            ))}
          </div>
          {due === "date" && (
            <input
              type="date"
              value={typedDate}
              onChange={(e) => setTypedDate(e.target.value)}
              aria-label="Due date"
              className="rounded-lg border border-line bg-surface-soft px-3 py-1.5 text-[13px] text-ink outline-none focus:border-accent-600"
            />
          )}
          <button
            type="submit"
            disabled={!draft.trim() || adding}
            className="nx-btn-quiet nx-btn-sm shrink-0"
          >
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
      </form>

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-ink-ghost">
          {status.kind === "loading"
            ? "Loading…"
            : openCount === 0
              ? "Nothing outstanding."
              : `${openCount} to do${
                  overdueCount > 0 ? `, ${overdueCount} overdue` : ""
                }.`}
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-[13px] text-ink-muted">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
          />
          Show done
        </label>
      </div>

      {status.kind === "error" && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          {status.message}
        </p>
      )}

      {status.kind !== "loading" && items.length === 0 && (
        <p className="text-sm text-neutral-500">
          Nothing on the list. Add one above, ask Nexus to remember
          something, or add prep to an event on the Calendar tab.
        </p>
      )}

      <div className="space-y-5">
        {buckets.map(({ bucket, items: rows }) => (
          <section key={bucket}>
            <h3
              className={`nx-label ${
                bucket === "overdue" ? "!text-red-700" : ""
              }`}
            >
              {BUCKET_LABEL[bucket]}
            </h3>

            <ul className="mt-2 space-y-1.5">
              {rows.map((item) => {
                const caption = captionFor(item, bucket);
                return (
                  <li key={item.id} className="group flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={busy.has(item.id)}
                      onChange={() => toggle(item)}
                      aria-label={item.title}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        item.done
                          ? "text-neutral-400 line-through"
                          : "text-neutral-800"
                      }`}
                    >
                      {item.title}
                    </span>
                    {caption && (
                      <span className="shrink-0 truncate text-[11px] text-ink-ghost">
                        {caption}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      aria-label={`Remove "${item.title}"`}
                      className="shrink-0 text-xs text-neutral-300 opacity-0 transition-opacity hover:text-neutral-600 group-hover:opacity-100 focus:opacity-100"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
