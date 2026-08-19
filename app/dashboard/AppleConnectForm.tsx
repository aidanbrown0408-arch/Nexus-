"use client";

import { useState } from "react";

// Apple's connect flow is a form, not a redirect. There's no OAuth for
// iCloud Calendar, so the user generates an app-specific password on
// Apple's site and pastes it here. Most of this component is the
// instructions for doing that — get them wrong and the error the user
// hits is "Apple rejected that", which explains nothing.

const APPLE_ID_URL = "https://appleid.apple.com/account/manage";

type Props = {
  onConnected: () => void;
  onCancel: () => void;
};

export default function AppleConnectForm({ onConnected, onCancel }: Props) {
  const [appleId, setAppleId] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/apple/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appleId, appPassword }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(body?.error ?? "Couldn't connect Apple Calendar");
      }

      // The password only ever needed to reach the server. Clear it here
      // so it isn't sitting in component state for the rest of the session.
      setAppPassword("");
      onConnected();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't connect Apple Calendar"
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4"
    >
      <h3 className="text-sm font-semibold text-neutral-900">
        Connect Apple Calendar
      </h3>
      <p className="mt-1 text-sm text-neutral-600">
        Apple doesn&apos;t offer a Connect button for iCloud Calendar, so
        this takes one extra step: generate an app-specific password and
        paste it below. It only works for Nexus, and you can revoke it any
        time.
      </p>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-neutral-600">
        <li>
          Sign in at{" "}
          <a
            href={APPLE_ID_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            appleid.apple.com
          </a>
        </li>
        <li>
          Go to <span className="font-medium">Sign-In and Security</span> →{" "}
          <span className="font-medium">App-Specific Passwords</span>
        </li>
        <li>Generate one and name it &ldquo;Nexus&rdquo;</li>
        <li>Copy it — Apple shows it only once</li>
      </ol>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-medium text-neutral-700">Apple ID</span>
          <input
            type="email"
            required
            autoComplete="username"
            value={appleId}
            onChange={(e) => setAppleId(e.target.value)}
            placeholder="you@icloud.com"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-neutral-700">
            App-specific password
          </span>
          <input
            type="password"
            required
            autoComplete="off"
            value={appPassword}
            onChange={(e) => setAppPassword(e.target.value)}
            placeholder="abcd-efgh-ijkl-mnop"
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm text-neutral-900 placeholder:font-sans placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <span className="mt-1 block text-xs text-neutral-500">
            Not your regular Apple ID password. Stored encrypted, and only
            used to read your calendars.
          </span>
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting || !appleId || !appPassword}
          className="rounded-full bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {/* Verified against iCloud before saving, so this can take a
              second or two — say so rather than looking frozen. */}
          {submitting ? "Checking with iCloud…" : "Connect"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="rounded-full px-3 py-1.5 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
