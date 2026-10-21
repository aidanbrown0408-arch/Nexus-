"use client";

import { useState } from "react";

// "This email is a thing I have to do" — one button, on the open message.
//
// No model call, on purpose. The subject line is what the user is looking
// at and is almost always the right title; the ones that aren't are
// easier to fix by typing over them in the Reminders list than by waiting
// on Claude to rewrite a title the user could have typed in the time the
// call takes. What the button really buys is the link back to the thread,
// which is the part they can't type.
type State = "idle" | "saving" | "added" | "error";

export default function AddTaskFromEmail({
  messageId,
  threadId,
  subject,
  from,
}: {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
}) {
  const [state, setState] = useState<State>("idle");

  async function add() {
    if (state === "saving" || state === "added") return;
    setState("saving");
    try {
      const res = await fetch("/api/prep/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subject?.trim() || `Reply to ${from}`,
          source: "email",
          sourceRef: { messageId, threadId, from },
        }),
      });
      if (!res.ok) throw new Error("failed");
      setState("added");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        type="button"
        onClick={add}
        disabled={state === "saving" || state === "added"}
        className="nx-btn-quiet nx-btn-sm"
      >
        {state === "saving"
          ? "Adding…"
          : state === "added"
            ? "Added to reminders"
            : "Add to reminders"}
      </button>
      {state === "error" && (
        <span className="text-[13px] text-red-700">
          Couldn&apos;t add that — try again.
        </span>
      )}
    </div>
  );
}
