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
  // Fired once the server confirms an edit, so the parent can patch its
  // copy of the event in place — not optimistic, for the same reason
  // deleting isn't: the fields shown are the fields on the calendar, and
  // showing an edit that didn't actually save would be worse than a
  // one-beat delay.
  onUpdated: (eventKey: string, fields: Partial<EventSummary>) => void;
};

export function formatDay(iso: string): string {
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

// Local date/time strings for the edit form's inputs — always the
// browser's own zone, the same convention AddEventForm uses.
function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "00:00";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EventRow({
  event,
  items,
  generated,
  onItemsChange,
  onGenerated,
  showCalendarName,
  onDeleted,
  onUpdated,
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

  // --- edit form state ------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editAllDay, setEditAllDay] = useState(false);
  const [editLocation, setEditLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const repeats = Boolean(event.recurringEventId);

  // What Nexus can actually write to. Google events need a calendar id;
  // Apple events need both the calendar's collection URL (also carried
  // in calendarId — see lib/events.ts) and the event's own CalDAV object
  // URL, since that's what a delete or an update is addressed to.
  const writable =
    event.source === "google"
      ? Boolean(event.calendarId)
      : Boolean(event.calendarId && event.objectUrl);

  const done = items.filter((item) => item.done).length;
  const allReady = items.length > 0 && done === items.length;

  function openEdit() {
    setEditSummary(event.summary);
    setEditDate(toDateInput(event.start));
    setEditStartTime(toTimeInput(event.start));
    setEditEndTime(toTimeInput(event.end));
    setEditAllDay(event.allDay);
    setEditLocation(event.location ?? "");
    setEditError(null);
    setEditing(true);
    setConfirmingDelete(false);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editSummary.trim()) return;

    setSaving(true);
    setEditError(null);

    const start = editAllDay ? editDate : `${editDate}T${editStartTime}`;
    const end = editAllDay ? editDate : `${editDate}T${editEndTime}`;

    try {
      const body: Record<string, unknown> = {
        summary: editSummary.trim(),
        start,
        end,
        allDay: editAllDay,
        location: editLocation.trim() || undefined,
        source: event.source,
        calendarId: event.calendarId,
      };
      if (event.source === "apple") body.objectUrl = event.objectUrl;

      const res = await fetch(
        `/api/calendar/events/${encodeURIComponent(event.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody?.error ?? "Couldn't save that change");

      onUpdated(event.key, {
        summary: editSummary.trim(),
        start,
        end,
        allDay: editAllDay,
        location: editLocation.trim() || null,
      });
      setEditing(false);
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Couldn't save that change"
      );
    } finally {
      setSaving(false);
    }
  }

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
        source: event.source,
        calendarId: event.calendarId ?? "",
        notifyGuests: String(notifyGuests),
        scope: repeats ? deleteScope : "one",
      });
      if (event.source === "apple" && event.objectUrl) {
        params.set("objectUrl", event.objectUrl);
      }
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
    <li className="flex gap-3 rounded-card border border-line-soft bg-surface-soft p-3">
      {/* The source stripe. Google and iCloud events are the same shape,
          so colour is the only thing telling them apart at a glance. */}
      <span
        aria-hidden
        className={`w-[3px] shrink-0 rounded-full ${
          event.source === "apple" ? "bg-amber-700/70" : "bg-accent-600"
        }`}
      />
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-[0.04em] text-ink-wisp">
            {formatTimeRange(event)}
          </p>
          <p className="mt-1 truncate text-sm font-semibold tracking-tight text-ink">
            {event.summary}
          </p>

          {(event.location ||
            event.attendeeCount > 0 ||
            repeats ||
            (showCalendarName && event.calendarName)) && (
            <p className="mt-1 truncate text-[13px] text-ink-ghost">
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

          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            {event.hangoutLink && (
              <a
                href={event.hangoutLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] font-medium text-accent-600 transition-colors hover:text-accent-800"
              >
                Join meeting
              </a>
            )}

            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={`rounded-full px-2.5 py-[3px] text-[11px] font-medium transition-colors ${
                allReady
                  ? "bg-emerald-100/70 text-emerald-800 hover:bg-emerald-100"
                  : items.length
                    ? "bg-amber-100/70 text-amber-800 hover:bg-amber-100"
                    : "bg-surface-sunken text-ink-muted hover:text-ink"
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

            {writable && !editing && !confirmingDelete && (
              <button
                type="button"
                onClick={openEdit}
                className="text-[11px] text-ink-wisp transition-colors hover:text-ink"
              >
                Edit
              </button>
            )}

            {writable && !editing && !confirmingDelete && (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="text-[11px] text-ink-wisp transition-colors hover:text-danger"
              >
                Delete
              </button>
            )}
          </div>

          {editing && (
            <form
              onSubmit={saveEdit}
              className="mt-2 rounded-xl border border-line bg-surface-soft p-3"
            >
              <input
                type="text"
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                placeholder="What is it?"
                maxLength={200}
                className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none"
                />
                {!editAllDay && (
                  <>
                    <input
                      type="time"
                      value={editStartTime}
                      onChange={(e) => setEditStartTime(e.target.value)}
                      className="rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="text-sm text-neutral-500">to</span>
                    <input
                      type="time"
                      value={editEndTime}
                      onChange={(e) => setEditEndTime(e.target.value)}
                      className="rounded-xl border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 focus:border-indigo-500 focus:outline-none"
                    />
                  </>
                )}
                <label className="flex items-center gap-1.5 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={editAllDay}
                    onChange={(e) => setEditAllDay(e.target.checked)}
                  />
                  All day
                </label>
              </div>

              <input
                type="text"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="Where? (optional)"
                className="mt-2 w-full rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />

              {repeats && (
                <p className="mt-2 text-xs text-neutral-500">
                  This repeats. Saving changes the whole series — Nexus
                  doesn&apos;t support editing a single occurrence yet.
                </p>
              )}

              {event.attendeeCount > 0 && (
                <p className="mt-2 text-xs text-neutral-500">
                  {event.attendeeCount} other{" "}
                  {event.attendeeCount === 1 ? "person is" : "people are"} on
                  this event. Guests aren&apos;t notified of edits.
                </p>
              )}

              {editError && (
                <p className="mt-2 rounded-xl bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                  {editError}
                </p>
              )}

              <div className="mt-3 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={saving || !editSummary.trim()}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-surface-soft disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {confirmingDelete && (
            <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm text-red-900">
                Delete “{event.summary}”?
              </p>

              {repeats && event.source === "google" && (
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

              {repeats && event.source === "apple" && (
                <p className="mt-1 text-xs text-red-800">
                  This repeats. Deleting it removes every occurrence —
                  Nexus can&apos;t take just one from an iCloud series.
                </p>
              )}

              {event.attendeeCount > 0 ? (
                <>
                  <p className="mt-1 text-xs text-red-800">
                    {event.attendeeCount} other{" "}
                    {event.attendeeCount === 1 ? "person is" : "people are"} on
                    this event.
                  </p>
                  {event.source === "google" && (
                    <label className="mt-2 flex items-start gap-2 text-xs text-red-900">
                      <input
                        type="checkbox"
                        checked={notifyGuests}
                        onChange={(e) => setNotifyGuests(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        Email them a cancellation. Leave this off and the
                        event just disappears from your calendar — they
                        keep theirs.
                      </span>
                    </label>
                  )}
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
                    : repeats && event.source === "google" && deleteScope === "series"
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
            <div className="mt-3 rounded-xl border border-line bg-surface-soft p-3">
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
                  className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!newTitle.trim()}
                  className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-50"
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
