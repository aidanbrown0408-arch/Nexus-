"use client";

import { useState } from "react";

// The propose → approve → execute loop, at its smallest.
//
// Nexus writes; the user reads it here and decides. Nothing is sent from
// this component — the draft lands in Gmail and the user opens it there.
// "Discard" calls the undo route rather than just clearing local state,
// so dismissing a bad draft actually removes it from their account.

type Draft = {
  id: string;
  threadId: string;
  to: string;
  subject: string;
  body: string;
  url: string;
};

type State =
  | { kind: "idle" }
  | { kind: "drafting" }
  | { kind: "ready"; draft: Draft; note: string | null; actionId: string | null }
  | { kind: "error"; message: string; needsReconnect: boolean };

export default function DraftReply({
  messageId,
  onDrafted,
}: {
  messageId: string;
  onDrafted?: () => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [instruction, setInstruction] = useState("");
  const [showInstruction, setShowInstruction] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  async function generate() {
    setState({ kind: "drafting" });
    try {
      const res = await fetch("/api/gmail/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          instruction: instruction.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setState({
          kind: "error",
          message: body?.error ?? "Couldn't draft a reply.",
          needsReconnect: body?.code === "scope_missing",
        });
        return;
      }

      setState({
        kind: "ready",
        draft: body.draft as Draft,
        note: body.note ?? null,
        actionId: body.actionId ?? null,
      });
      onDrafted?.();
    } catch {
      setState({
        kind: "error",
        message: "Couldn't reach Nexus. Try again.",
        needsReconnect: false,
      });
    }
  }

  async function discard(actionId: string | null) {
    if (!actionId) {
      setState({ kind: "idle" });
      return;
    }
    setDiscarding(true);
    try {
      await fetch(`/api/actions/${actionId}/undo`, { method: "POST" });
    } finally {
      setDiscarding(false);
      setState({ kind: "idle" });
      setInstruction("");
      setShowInstruction(false);
    }
  }

  if (state.kind === "ready") {
    const { draft, note, actionId } = state;
    return (
      <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium text-indigo-900">
            Draft saved to Gmail
          </p>
          <p className="truncate text-xs text-indigo-700" title={draft.to}>
            To {draft.to}
          </p>
        </div>

        <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
          {draft.body}
        </p>

        {note && (
          <p className="mt-2 rounded-xl bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            {note}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={draft.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            Open in Gmail
          </a>
          <button
            type="button"
            onClick={() => discard(actionId)}
            disabled={discarding}
            className="rounded-full border border-line bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-surface-soft disabled:opacity-60"
          >
            {discarding ? "Discarding…" : "Discard"}
          </button>
          <span className="text-xs text-neutral-500">
            Nothing was sent.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2">
      {state.kind === "error" && (
        <p className="mb-2 rounded-xl bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
          {state.message}{" "}
          {state.needsReconnect && (
            <a href="/api/google/connect" className="font-medium underline">
              Reconnect Gmail
            </a>
          )}
        </p>
      )}

      {showInstruction && (
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") generate();
          }}
          maxLength={500}
          placeholder="Optional: decline politely, ask for the deck…"
          className="mb-2 w-full rounded-xl border border-line px-2.5 py-1.5 text-xs text-neutral-800 outline-none focus:border-indigo-300"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={state.kind === "drafting"}
          className="rounded-full border border-line px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.kind === "drafting" ? "Drafting…" : "Draft reply"}
        </button>
        {state.kind !== "drafting" && (
          <button
            type="button"
            onClick={() => setShowInstruction((v) => !v)}
            className="text-xs text-neutral-500 underline-offset-2 hover:underline"
          >
            {showInstruction ? "Never mind" : "Tell it what to say"}
          </button>
        )}
      </div>
    </div>
  );
}
