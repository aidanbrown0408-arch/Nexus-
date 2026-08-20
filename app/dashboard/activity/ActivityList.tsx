"use client";

import { useCallback, useEffect, useState } from "react";

type Action = {
  id: string;
  kind: string;
  summary: string;
  undoable: boolean;
  undoneAt: string | null;
  createdAt: string;
  // Set locally when the reversal produced a new thing rather than
  // restoring the old one, or when it turned out not to be reversible at
  // all. Neither is knowable before the attempt.
  recreated?: boolean;
  unreversible?: boolean;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; actions: Action[] }
  | { kind: "error"; message: string };

// Plain words, because the point of this page is that a non-technical
// reader can audit it. "draft_reply" is a column name, not an answer.
const KIND_LABEL: Record<string, string> = {
  draft_reply: "Draft",
  archive: "Archived",
  label: "Labelled",
  filter: "Filter",
  trash: "Trashed",
  event_create: "Event added",
  event_delete: "Event removed",
};

function timeOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Grouped by day, and the two most recent days are named rather than
// dated — "Today" is how anyone actually reads a log of their own week.
function dayHeading(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "Earlier";

  const today = new Date();
  // Decrementing the date component rather than subtracting 24 hours.
  // The day after a spring-forward is 23 hours long, so a fixed
  // subtraction lands two calendar days back and labels the wrong rows
  // "Yesterday" — in a page whose entire value is a truthful timeline.
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (at.toDateString() === today.toDateString()) return "Today";
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";

  // The year is included because the heading doubles as the group's
  // React key: weekday+month+day repeats across years, so two sections a
  // year apart would collide and reconcile as one, rendering rows under
  // the wrong heading. It also just reads better in an audit log.
  const sameYear = at.getFullYear() === today.getFullYear();
  return at.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function groupByDay(actions: Action[]): { day: string; actions: Action[] }[] {
  const groups: { day: string; actions: Action[] }[] = [];
  for (const action of actions) {
    const day = dayHeading(action.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.actions.push(action);
    else groups.push({ day, actions: [action] });
  }
  return groups;
}

export default function ActivityList() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  // A set, not a single slot. With one slot, finishing an undo on B
  // re-enabled the still-in-flight button on A, and a second click ran
  // the reversal twice — which for a restored event means two meetings
  // and two invitations.
  const [undoing, setUndoing] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/actions", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: body?.error ?? "Couldn't load your activity.",
        });
        return;
      }
      setStatus({ kind: "ready", actions: (body.actions ?? []) as Action[] });
    } catch {
      setStatus({ kind: "error", message: "Couldn't reach Nexus." });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function undo(id: string) {
    if (undoing.has(id)) return;
    setUndoing((current) => new Set(current).add(id));
    setFailed((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    try {
      const res = await fetch(`/api/actions/${id}/undo`, { method: "POST" });
      const body = await res.json().catch(() => ({}));

      // An undo that fails silently is worse than no undo button at all —
      // the user walks away believing the change was reversed.
      if (!res.ok) {
        setFailed((current) => ({
          ...current,
          [id]: body?.error ?? "That couldn't be undone.",
        }));
        // A 422 means this action was never structurally reversible —
        // nothing recorded to act on, or a kind the undo route doesn't
        // handle. Clicking again can't help, so the button goes rather
        // than sitting there inviting a retry that will fail forever.
        if (res.status === 422) {
          setStatus((current) =>
            current.kind === "ready"
              ? {
                  kind: "ready",
                  actions: current.actions.map((action) =>
                    action.id === id
                      ? { ...action, undoable: false, unreversible: true }
                      : action
                  ),
                }
              : current
          );
        }
        return;
      }

      setStatus((current) =>
        current.kind === "ready"
          ? {
              kind: "ready",
              actions: current.actions.map((action) =>
                action.id === id
                  ? {
                      ...action,
                      undoneAt: new Date().toISOString(),
                      // The undo route flags a restored event as a *new*
                      // one. Showing it as a clean reversal would claim
                      // the guests' copies and any prep checklist came
                      // back too, and they didn't.
                      recreated: Boolean(body?.recreated),
                    }
                  : action
              ),
            }
          : current
      );
    } catch {
      setFailed((current) => ({
        ...current,
        [id]: "Couldn't reach Nexus.",
      }));
    } finally {
      setUndoing((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  if (status.kind === "loading") {
    return (
      <div className="mt-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-neutral-100" />
        ))}
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="mt-6">
        <p className="text-sm text-neutral-600">{status.message}</p>
        <button
          type="button"
          onClick={load}
          className="mt-3 rounded-full border border-neutral-200 px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!status.actions.length) {
    return (
      <p className="mt-6 text-sm text-neutral-500">
        Nexus hasn&apos;t changed anything on your account yet. When it drafts
        a reply, archives mail or adds an event, it shows up here — with a way
        to put it back.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {groupByDay(status.actions).map((group) => (
        <section key={group.day}>
          <h2 className="text-xs font-medium uppercase tracking-wide text-neutral-400">
            {group.day}
          </h2>
          <ul className="mt-2 divide-y divide-neutral-100 border-t border-neutral-100">
            {group.actions.map((action) => {
              const undone = Boolean(action.undoneAt);
              return (
                <li key={action.id} className="py-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0">
                      <p
                        className={
                          "text-sm " +
                          (undone
                            ? "text-neutral-400 line-through"
                            : "text-neutral-800")
                        }
                      >
                        {action.summary}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-400">
                        {timeOf(action.createdAt)}
                        {" · "}
                        {KIND_LABEL[action.kind] ?? action.kind}
                        {undone && " · undone"}
                        {action.unreversible && " · can't be undone"}
                      </p>
                      {action.recreated && (
                        <p className="mt-1 text-xs text-amber-700">
                          Put back as a new event — guests were invited
                          again, and anything attached to the original
                          didn&apos;t come with it.
                        </p>
                      )}
                      {failed[action.id] && (
                        <p className="mt-1 text-xs text-amber-700">
                          {failed[action.id]}
                        </p>
                      )}
                    </div>

                    {action.undoable && !undone && (
                      <button
                        type="button"
                        onClick={() => undo(action.id)}
                        disabled={undoing.has(action.id)}
                        className="shrink-0 rounded-full border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60"
                      >
                        {undoing.has(action.id) ? "Undoing…" : "Undo"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
