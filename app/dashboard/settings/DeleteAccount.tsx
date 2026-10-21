"use client";

import { useState } from "react";
import { useClerk } from "@clerk/nextjs";

// The one irreversible button in the app, so it asks for the word rather
// than a click — and says exactly what goes.
export default function DeleteAccount() {
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Couldn't delete your account.");
      }
      await signOut({ redirectUrl: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete your account.");
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 rounded-panel border border-red-200 bg-white p-6">
      <h2 className="text-[17px] font-semibold text-ink">Delete account</h2>
      <p className="mt-2 text-sm text-neutral-600">
        Disconnects Google and iCloud, revokes Nexus&apos;s access to them,
        and permanently deletes your profile, reminders, memory, briefs and
        activity history, then your sign-in. Nothing in your Gmail or
        calendar is changed. This can&apos;t be undone.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="nx-btn nx-btn-sm mt-4 border border-red-300 text-red-700 hover:bg-red-50"
        >
          Delete my account…
        </button>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor="delete-confirm">
            Type DELETE to confirm
          </label>
          <input
            id="delete-confirm"
            className="nx-input sm:max-w-[220px]"
            placeholder="Type DELETE to confirm"
            value={confirm}
            autoComplete="off"
            onChange={(e) => setConfirm(e.target.value)}
          />
          <button
            type="button"
            disabled={confirm !== "DELETE" || busy}
            onClick={onDelete}
            className="nx-btn nx-btn-sm bg-danger text-white disabled:opacity-40"
          >
            {busy ? "Deleting…" : "Permanently delete"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              setConfirm("");
              setError(null);
            }}
            className="nx-btn-quiet nx-btn-sm"
          >
            Cancel
          </button>
        </div>
      )}
      {error ? (
        <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
}
