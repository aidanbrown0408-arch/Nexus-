"use client";

import { useEffect, useState } from "react";
import { useSpeaker, useVoiceOptions } from "../useSpeech";

// Auditioning the browser's voices.
//
// The scoring in useSpeech picks a good one without being asked, but
// "good" is a guess made from a voice's name — the inventory differs by
// machine, and whether a voice sounds like a person is not something a
// heuristic can settle. So: list them, best first, and let the ear
// decide. The choice is per-device (see STORED_VOICE_KEY) and saves the
// moment it's made, which is why this sits outside the profile form's
// Save button rather than inside it.

// Long enough to hear rhythm and warmth rather than just timbre, and
// written the way Nexus actually talks.
const SAMPLE =
  "You've got three things today. The one that matters is Sarah's " +
  "deck review at two — she's still waiting on your numbers.";

type Hosted = { hosted: boolean; provider: string | null } | null;

export default function VoicePicker() {
  const { voices, selected, effective, choose } = useVoiceOptions();
  const { speak, cancel, speaking, prime } = useSpeaker();
  const [hosted, setHosted] = useState<Hosted>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/speech", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { hosted: boolean; provider: string | null };
        if (!cancelled) setHosted(body);
      } catch {
        /* assume browser voices; the list below is still true */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Stop talking on the way out — speechSynthesis outlives the component.
  useEffect(() => cancel, [cancel]);

  const usingHosted = hosted?.hosted === true;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-sm font-medium text-neutral-800">Voice</h3>
        {usingHosted && (
          <span className="text-xs text-neutral-500">
            Using the {hosted?.provider === "elevenlabs" ? "ElevenLabs" : "OpenAI"} voice
          </span>
        )}
      </div>

      <p className="mt-1 text-xs text-neutral-500">
        {usingHosted
          ? "Replies are spoken with a hosted neural voice. These browser voices are the backup, used if that ever fails."
          : "Which of your device's voices Nexus uses. Sorted best-sounding first — the top one is what it picks on its own."}
      </p>

      {voices.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-400">
          Your browser hasn&apos;t offered any voices. Chrome, Edge and Safari
          all have them; Firefox depends on the system.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => {
              choose(e.target.value);
              cancel();
            }}
            className="min-w-[15rem] rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          >
            <option value="">
              Recommended{voices[0] ? ` — ${voices[0].name}` : ""}
            </option>
            {voices.map((voice) => (
              <option key={`${voice.name}-${voice.lang}`} value={voice.name}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              if (speaking) {
                cancel();
                return;
              }
              // The tap that asks to hear it is also the gesture iOS
              // wants before it will play anything.
              prime();
              speak(SAMPLE);
            }}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
          >
            {speaking ? "Stop" : "Preview"}
          </button>

          {selected && (
            <button
              type="button"
              onClick={() => {
                choose("");
                cancel();
              }}
              className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
            >
              Reset
            </button>
          )}
        </div>
      )}

      {!usingHosted && effective && (
        <p className="mt-2 text-xs text-neutral-400">
          Saved on this device only — voices differ from one machine to the next.
        </p>
      )}
    </div>
  );
}
