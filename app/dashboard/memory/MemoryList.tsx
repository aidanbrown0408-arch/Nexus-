"use client";

import { useEffect, useState } from "react";

type Fact = {
  id: string;
  category: "person" | "deadline" | "project" | "preference";
  fact: string;
  sourceLabel: string | null;
  sourceKind: "email" | "calendar" | null;
  expiresAt: string | null;
  createdAt: string;
};

type Status =
  | { kind: "loading" }
  | { kind: "ready"; facts: Fact[] }
  | { kind: "error"; message: string };

// Plain words. Same reasoning as the activity page: a column value is
// not an answer to "what does Nexus think it knows about me".
const CATEGORY_LABEL: Record<Fact["category"], string> = {
  person: "Person",
  deadline: "Deadline",
  project: "Project",
  preference: "How you work",
};

function learnedOn(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

// Shown only for facts that have one. "Until Oct 15" is the honest way to
// display something Nexus intends to forget, and it's also the clearest
// signal that memory isn't a permanent record.
function expiryNote(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `until ${at.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

export default function MemoryList() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [forgetting, setForgetting] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/facts", { cache: "no-store" });
        if (!res.ok) throw new Error("load failed");
        const body = (await res.json()) as { facts: Fact[] };
        if (!cancelled) setStatus({ kind: "ready", facts: body.facts ?? [] });
      } catch {
        if (!cancelled) {
          setStatus({
            kind: "error",
            message: "Couldn't load what Nexus remembers.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function forget(id: string) {
    setForgetting((current) => new Set(current).add(id));
    try {
      const res = await fetch(`/api/facts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      // Removed from the list rather than struck through: this page is
      // about what Nexus is still working from, and a forgotten fact
      // isn't part of that answer any more.
      setStatus((current) =>
        current.kind === "ready"
          ? { kind: "ready", facts: current.facts.filter((f) => f.id !== id) }
          : current
      );
    } catch {
      // Leaving the row in place is the honest failure: it's still
      // remembered, and pretending otherwise would be the one thing this
      // page can't afford to get wrong.
    } finally {
      setForgetting((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  if (status.kind === "loading") {
    return (
      <div className="mt-8 space-y-3">
        <div className="h-16 w-full animate-pulse rounded-2xl bg-neutral-100" />
        <div className="h-16 w-full animate-pulse rounded-2xl bg-neutral-100" />
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <p className="mt-8 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800">
        {status.message}
      </p>
    );
  }

  if (!status.facts.length) {
    return (
      <div className="mt-8 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-neutral-600">
          Nothing yet. Nexus takes notes while it writes your morning
          brief, so this fills in over the first few days — and stays
          empty if there is nothing durable worth keeping.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-8 space-y-3">
      {status.facts.map((fact) => {
        const expiry = expiryNote(fact.expiresAt);
        return (
          <li
            key={fact.id}
            className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-neutral-800">{fact.fact}</p>
                <p className="mt-1 text-xs text-neutral-400">
                  {CATEGORY_LABEL[fact.category] ?? "Note"} · learned{" "}
                  {learnedOn(fact.createdAt)}
                  {expiry ? ` · kept ${expiry}` : ""}
                  {fact.sourceLabel
                    ? ` · from ${
                        fact.sourceKind === "calendar" ? "the event" : ""
                      } "${fact.sourceLabel}"`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => forget(fact.id)}
                disabled={forgetting.has(fact.id)}
                className="shrink-0 text-xs font-medium text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-800 disabled:opacity-60"
              >
                {forgetting.has(fact.id) ? "Forgetting…" : "Forget"}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
