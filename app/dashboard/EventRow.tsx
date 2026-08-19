"use client";

import { useState } from "react";
import type { EventSummary } from "@/lib/events";
import type { PrepItem } from "@/lib/prep";

// One event, plus the short list of things that have to happen before
// it. Collapsed, the row says how ready you are; expanded, it's an
// editable checklist.
//
// Every mutation here is optimistic. These are one-field writes on a
// list the user is looking at — waiting on a round trip to tick a box
// makes the whole card feel broken, so state moves first and rolls back
// if the server disagrees.

type Props = {
  event: EventSummary;
  items: PrepItem[];
  // Whether Claude has already drafted for this event. An empty list
  // after a draft means "nothing to do", not "not drafted yet".
  generated: boolean;
  onItemsChange: (eventKey: string, items: PrepItem[]) => void;
  onGenerated: (eventKey: string) => void;
  showCalendarName: boolean;
  // `seriesId` is passed when a whole repeating series went, so the
  // parent can clear every occurrence rather than one row.
  onDeleted: (eventKey: string, seriesId?: string) => void;
};

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  if (isToday) return "Today";
  if (isTomorrow) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTimeRange(event: EventSummary): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime())) return "";
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (Number.isNaN(end.getTime())) return time(start);
  return `${time(start)} – ${time(end)}`;
}

export default function EventRow({
  event,
  items,
  generated,
  onItemsChange,
  onGenerated,
  showCalendarName,
  onDeleted,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Deletion is the one thing here that isn't optimistic and isn't one
  // click. It gets a confirmation step of its own, because the mistake it
  // prevents is a cancelled meeting rather than a mis-ticked checkbox.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notifyGuests, setNotifyGuests] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // For a repeating event, whether to take the whole series. Defaults to
  // just this one: it's the smaller act, and the one someone clicking
  // Delete on a single row most often means.
  const [deleteScope, setDeleteScope] = useState<"one" | "series">("one");

  const repeats = Boolean(event.recurringEventId);

  // Apple events reach us over CalDAV, which has no write path here.
  const deletable = event.source === "google" && Boolean(event.calendarId);

  const done = items.filter((item) => item.done).length;
  const allReady = items.length > 0 && done === items.length;

  async function toggleItem(item: PrepItem) {
    const next = items.map((i) =>
      i.id === item.id ? { ...i, done: !i.done } : i
    );
    onItemsChange(event.key, next);
    setError(null);

    try {
      const res = await fetch(`/api/prep/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !item.done }),
      });
      if (!res.ok) throw new Error();
    } catch {
      onItemsChange(event.key, items);
      setError("Couldn't save that — try again.");
    }
  }

  async function removeItem(item: PrepItem) {
    const next = items.filter((i) => i.id !== item.id);
    onItemsChange(event.key, next);
    setError(null);

    try {
      const res = await fetch(`/api/prep/items/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      onItemsChange(event.key, items);
      setError("Couldn't remove that — try again.");
    }
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setNewTitle("");
    setError(null);

    try {
      const res = await fetch("/api/prep/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: event.key,
          title,
          eventSummary: event.summary,
          eventStart: event.start,
        }),
      });
      if (!res.ok) throw new Error();
      // The id comes from the database, so unlike the other two this one
      // waits — an optimistic row with a fake id couldn't be ticked off
      // until the next refresh.
      const body = (await res.json()) as { item: PrepItem };
      onItemsChange(event.key, [...items, body.item]);
    } catch {
      setNewTitle(title);
      setError("Couldn't add that — try again.");
    }
  }

  async function draft() {
    setDrafting(true);
    setError(null);

    try {
      const res = await fetch("/api/prep/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey: event.key }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Couldn't draft a prep list");

      const suggestions = (body.items ?? []) as PrepItem[];
      // Redrafting replaces Claude's untouched suggestions server-side,
      // so mirror that here: keep what the user owns or has ticked off.
      const kept = items.filter((i) => i.origin === "user" || i.done);
      onItemsChange(event.key, [...kept, ...suggestions]);
      onGenerated(event.key);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't draft a prep list"
      );
    } finally {
      setDrafting(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        calendarId: event.calendarId ?? "",
        notifyGuests: String(notifyGuests),
        scope: repeats ? deleteScope : "one",
      });
      if (repeats && event.recurringEventId) {
        params.set("seriesId", event.recurringEventId);
      }
      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(event.id)}?${params}`,
        { method: "DELETE" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "Couldn't delete that event");

      // Removed from the list only once the server confirms. An
      // optimistic disappearance here would be a meeting the user thinks
      // is cancelled when it isn't.
      //
      // A series delete takes every row of that series with it, not just
      // the one clicked — otherwise the other occurrences sit there
      // looking alive until the next refresh.
      if (body.deletedSeries && body.seriesId) {
        onDeleted(event.key, body.seriesId as string);
      } else {
        onDeleted(event.key);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't delete that event"
      );
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
            event.source === "apple" ? "bg-neutral-800" : "bg-indigo-500"
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="truncate text-sm font-medium text-neutral-900">
              {event.summary}
            </p>
            <span className="shrink-0 text-xs text-neutral-400">
              {formatDay(event.start)}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-neutral-600">
            {formatTimeRange(event)}
          </p>

          {(event.location ||
            event.attendeeCount > 0 ||
            repeats ||
            (showCalendarName && event.calendarName)) && (
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {[
                event.location,
                event.attendeeCount > 0
                  ? `${event.attendeeCount} attendee${
                      event.attendeeCount === 1 ? "" : "s"
                    }`
                  : null,
                showCalendarName
                  ? event.calendarName ??
                    (event.source === "apple" ? "iCloud" : "Google")
                  : null,
                repeats ? "Repeats" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {event.hangoutLink && (
              <a
                href={event.hangoutLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                Join meeting
              </a>
            )}

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={`rounded-full px-2 py-0.5 text-xs font-medium transition-colors ${
                allReady
                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : items.length
                    ? "bg-amber-50 text-amber-800 hover:bg-amber-100"
                    : "text-neutral-500 hover:text-neutral-800"
              }`}
              aria-expanded={expanded}
            >
              {/* Three states worth distinguishing at a glance: ready,
                  partly ready, and nothing tracked yet. */}
              {allReady
                ? "Ready"
                : items.length
                  ? `${done} of ${items.length} ready`
                  : generated
                    ? "Nothing to prep"
                    : "Prep"}
            </button>

            {deletable && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-xs text-neutral-400 transition-colors hover:text-red-600"
              >
                Delete
              </button>
            )}
          </div>

          {confirmingDelete && (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-900">
                Delete “{event.summary}”?
              </p>

              {repeats && (
                <div className="mt-2 space-y-1">
                  <label className="flex items-center gap-2 text-xs text-red-900">
                    <input
                      type="radio"
                      name={`scope-${event.key}`}
                      checked={deleteScope === "one"}
                      onChange={() => setDeleteScope("one")}
                    />
                    <span>Just this one</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-red-900">
                    <input
                      type="radio"
                      name={`scope-${event.key}`}
                      checked={deleteScope === "series"}
                      onChange={() => setDeleteScope("series")}
                    />
                    <span>
                      Every occurrence — past and future
                    </span>
                  </label>
                </div>
              )}

              {event.attendeeCount > 0 ? (
                <>
                  <p className="mt-1 text-xs text-red-800">
                    {event.attendeeCount} other{" "}
                    {event.attendeeCount === 1 ? "person is" : "people are"} on
                    this event.
                  </p>
                  <label className="mt-2 flex items-start gap-2 text-xs text-red-900">
                    <input
                      type="checkbox"
                      checked={notifyGuests}
                      onChange={(e) => setNotifyGuests(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Email them a cancellation. Leave this off and the event
                      just disappears from your calendar — they keep theirs.
                    </span>
                  </label>
                </>
              ) : (
                <p className="mt-1 text-xs text-red-800">
                  Nobody else is on it.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={remove}
                  disabled={deleting}
                  className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-60"
                >
                  {deleting
                    ? "Deleting…"
                    : repeats && deleteScope === "series"
                      ? "Delete the series"
                      : "Delete it"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setNotifyGuests(false);
                  }}
                  disabled={deleting}
                  className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60"
                >
                  Keep it
                </button>
                <span className="text-xs text-red-700">
                  Undo brings it back as a new event.
                </span>
              </div>
            </div>
          )}

          {expanded && (
            <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
              {items.length > 0 && (
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li key={item.id} className="group flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => toggleItem(item)}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
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
                      <button
                        type="button"
                        onClick={() => removeItem(item)}
                        aria-label={`Remove "${item.title}"`}
                        className="shrink-0 text-xs text-neutral-300 opacity-0 transition-opacity hover:text-neutral-600 group-hover:opacity-100 focus:opacity-100"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {items.length === 0 && (
                <p className="text-sm text-neutral-500">
                  {generated
                    ? "Claude didn't find anything that needs doing beforehand. Add your own below."
                    : "Nothing tracked yet for this event."}
                </p>
              )}

              <form onSubmit={addItem} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Add something to do first…"
                  className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Add
                </button>
              </form>

              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={draft}
                  disabled={drafting}
                  className="text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-700 disabled:opacity-60"
                >
                  {drafting
                    ? "Thinking…"
                    : generated
                      ? "Redraft with Claude"
                      : "Draft with Claude"}
                </button>
                {generated && (
                  <span className="text-xs text-neutral-400">
                    Keeps anything you wrote or ticked off
                  </span>
                )}
              </div>

              {error && (
                <p className="mt-2 text-xs text-red-700">{error}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
