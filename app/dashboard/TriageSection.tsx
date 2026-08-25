"use client";

import { useState } from "react";

// "These 14 look like noise."
//
// The batch-approve shape from the roadmap, and the first place Nexus
// acts on many things at once. Two decisions make that safe enough to be
// worth it:
//
//   - Every pick carries its reason. A list of 14 subject lines is
//     something you either trust blindly or ignore; a list of 14 with
//     "Weekly Medium digest" beside each is something you can actually
//     read in five seconds.
//   - Boxes start checked, but unchecking is the point. The user is
//     approving a proposal, not confirming a decision already made.
//
// Archiving is a complete no-op on the message — Gmail's INBOX is just a
// label — so undo genuinely puts everything back.

type Proposal = {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  date: string;
  unread: boolean;
  reason: string;
};

type Label = { id: string; name: string; system: boolean };

type State =
  | { kind: "idle" }
  | { kind: "scanning" }
  | {
      kind: "review";
      proposals: Proposal[];
      labels: Label[];
      scanned: number;
      vipProtected: number;
    }
  | { kind: "archiving" }
  | { kind: "done"; count: number; labelName: string | null; actionId: string | null }
  | { kind: "error"; message: string; needsReconnect: boolean };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Says out loud that the VIP list did something. A protection the user
// can't see is one they have no reason to believe in, and believing in it
// is what makes the archive list safe to approve without reading it.
function VipNote({ count }: { count: number }) {
  if (!count) return null;
  return (
    <p className="mt-1 text-xs text-neutral-500">
      Left {count} message{count === 1 ? "" : "s"} alone
      {count === 1 ? " — it was" : " — they were"} from someone on your
      list of people who matter.
    </p>
  );
}

export default function TriageSection() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [labelChoice, setLabelChoice] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [undoing, setUndoing] = useState(false);

  async function scan() {
    setState({ kind: "scanning" });
    try {
      const res = await fetch("/api/gmail/triage", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          message: body?.error ?? "Couldn't scan your inbox.",
          needsReconnect: body?.code === "scope_missing",
        });
        return;
      }
      const proposals = (body.proposals ?? []) as Proposal[];
      setChecked(new Set(proposals.map((p) => p.id)));
      setState({
        kind: "review",
        proposals,
        labels: (body.labels ?? []) as Label[],
        scanned: body.scanned ?? 0,
        vipProtected: body.vipProtected ?? 0,
      });
    } catch {
      setState({
        kind: "error",
        message: "Couldn't reach Nexus. Try again.",
        needsReconnect: false,
      });
    }
  }

  function toggle(id: string) {
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function archive() {
    // Array.from rather than a spread: the tsconfig target predates
    // downlevel iteration over a Set.
    const ids = Array.from(checked);
    if (!ids.length) return;

    setState({ kind: "archiving" });
    try {
      const res = await fetch("/api/gmail/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          labelName: newLabel.trim() || undefined,
          labelId: !newLabel.trim() && labelChoice ? labelChoice : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          kind: "error",
          message: body?.error ?? "Couldn't archive those.",
          needsReconnect: body?.code === "scope_missing",
        });
        return;
      }
      setState({
        kind: "done",
        count: body.archived ?? ids.length,
        labelName: body.label?.name ?? null,
        actionId: body.actionId ?? null,
      });
      setChecked(new Set());
      setLabelChoice("");
      setNewLabel("");
    } catch {
      setState({
        kind: "error",
        message: "Couldn't reach Nexus. Try again.",
        needsReconnect: false,
      });
    }
  }

  async function undo(actionId: string) {
    setUndoing(true);
    try {
      await fetch(`/api/actions/${actionId}/undo`, { method: "POST" });
      setState({ kind: "idle" });
    } finally {
      setUndoing(false);
    }
  }

  return (
    <section className="mt-8 w-full max-w-3xl rounded-panel border border-line bg-white p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight text-ink">Tidy up</h2>
          <p className="text-sm text-neutral-500">
            Nexus reads your inbox and points at what was never going to
            need you.
          </p>
        </div>
        {(state.kind === "idle" ||
          state.kind === "done" ||
          state.kind === "error") && (
          <button
            type="button"
            onClick={scan}
            className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Scan my inbox
          </button>
        )}
      </header>

      {state.kind === "scanning" && (
        <p className="mt-4 text-sm text-neutral-500">Reading your inbox…</p>
      )}

      {state.kind === "archiving" && (
        <p className="mt-4 text-sm text-neutral-500">Archiving…</p>
      )}

      {state.kind === "error" && (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}{" "}
          {state.needsReconnect && (
            <a href="/api/google/connect" className="font-medium underline">
              Reconnect Gmail
            </a>
          )}
        </p>
      )}

      {state.kind === "done" && (
        <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Archived {state.count} message{state.count === 1 ? "" : "s"}
              {state.labelName ? ` and labelled them “${state.labelName}”` : ""}
              .
            </span>
            {state.actionId && (
              <button
                type="button"
                onClick={() => undo(state.actionId!)}
                disabled={undoing}
                className="text-xs font-medium underline disabled:opacity-60"
              >
                {undoing ? "Putting them back…" : "Undo"}
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-emerald-800">
            Nothing was deleted — they&apos;re still in All Mail.
          </p>
        </div>
      )}

      {state.kind === "review" && (
        <div className="mt-4">
          {state.proposals.length === 0 ? (
            <>
              <p className="text-sm text-neutral-500">
                Read {state.scanned} message{state.scanned === 1 ? "" : "s"} and
                nothing looked like noise. Your inbox is already clean.
              </p>
              <VipNote count={state.vipProtected} />
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-sm text-neutral-700">
                    {state.proposals.length} of {state.scanned} look like noise.
                  </p>
                  <VipNote count={state.vipProtected} />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setChecked(
                      checked.size === state.proposals.length
                        ? new Set()
                        : new Set(state.proposals.map((p) => p.id))
                    )
                  }
                  className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                >
                  {checked.size === state.proposals.length
                    ? "Uncheck all"
                    : "Check all"}
                </button>
              </div>

              <ul className="mt-2 max-h-80 divide-y divide-line-soft overflow-y-auto rounded-xl border border-line">
                {state.proposals.map((p) => (
                  <li key={p.id} className="px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={checked.has(p.id)}
                        onChange={() => toggle(p.id)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span
                            className={`truncate text-sm ${
                              p.unread
                                ? "font-semibold text-neutral-900"
                                : "font-medium text-neutral-700"
                            }`}
                            title={p.fromEmail}
                          >
                            {p.from}
                          </span>
                          <span className="shrink-0 text-xs text-neutral-400">
                            {formatDate(p.date)}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-neutral-600">
                          {p.subject}
                        </span>
                        {/* The reason is the whole point — without it
                            this list is unreadable at a glance. */}
                        <span className="mt-0.5 block truncate text-xs text-indigo-700">
                          {p.reason}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-neutral-500">
                  Label them too (optional):
                </span>
                <select
                  value={labelChoice}
                  onChange={(e) => {
                    setLabelChoice(e.target.value);
                    if (e.target.value) setNewLabel("");
                  }}
                  disabled={Boolean(newLabel.trim())}
                  className="rounded-xl border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 focus:border-indigo-500 focus:outline-none disabled:bg-surface-sunken"
                >
                  <option value="">No label</option>
                  {state.labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-neutral-400">or</span>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="New label name"
                  maxLength={100}
                  className="min-w-0 flex-1 rounded-xl border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={archive}
                  disabled={checked.size === 0}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Archive {checked.size}
                </button>
                <button
                  type="button"
                  onClick={() => setState({ kind: "idle" })}
                  className="rounded-full border border-neutral-300 bg-white px-4 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-surface-soft"
                >
                  Cancel
                </button>
                <span className="text-xs text-neutral-500">
                  Archive isn&apos;t delete. Undo puts it all back.
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
