"use client";

import { useEffect, useState } from "react";
import {
  setStoredHostedVoice,
  storedHostedVoice,
  useSpeaker,
  useVoiceOptions,
} from "../useSpeech";

// Choosing how Nexus sounds.
//
// With a hosted provider (the usual setup) the choice that matters is
// which neural voice reads replies, so that comes first with a preview.
// The browser's own voices are the backup — used only if the hosted voice
// fails — and sit underneath, folded away. Without a provider they are
// the voice, and the list is shown open.
//
// Both choices are saved on this device the moment they're made, which is
// why this sits outside the profile form's Save button.

// Long enough to hear rhythm and warmth rather than just timbre, and
// written the way Nexus actually talks.
const SAMPLE =
  "Morning. You've got three things today, but only one that really " +
  "matters: Sarah's deck review at two. She's still waiting on your " +
  "numbers, so I'd send those first.";

type HostedVoice = { id: string; label: string; note: string };
type Hosted = {
  hosted: boolean;
  provider: string | null;
  voices: HostedVoice[];
  defaultVoice: string | null;
} | null;

export default function VoicePicker() {
  const { voices, selected, effective, choose } = useVoiceOptions();
  const { speak, cancel, speaking, prime } = useSpeaker();
  const [hosted, setHosted] = useState<Hosted>(null);
  const [hostedVoice, setHostedVoice] = useState("");
  const [showBackup, setShowBackup] = useState(false);

  useEffect(() => {
    setHostedVoice(storedHostedVoice() ?? "");
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/speech", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as NonNullable<Hosted>;
        if (!cancelled) setHosted({ ...body, voices: body.voices ?? [] });
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
  const choosable = usingHosted && (hosted?.voices.length ?? 0) > 0;
  const currentHosted =
    hostedVoice || hosted?.defaultVoice || hosted?.voices[0]?.id || "";

  const preview = () => {
    if (speaking) {
      cancel();
      return;
    }
    // The tap that asks to hear it is also the gesture iOS wants before
    // it will play anything.
    prime();
    speak(SAMPLE);
  };

  const previewButton = (
    <button
      type="button"
      onClick={preview}
      className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50"
    >
      {speaking ? "Stop" : "Preview"}
    </button>
  );

  const browserPicker =
    voices.length === 0 ? (
      <p className="mt-3 text-xs text-neutral-400">
        Your browser hasn&apos;t offered any voices. Chrome, Edge and Safari all
        have them; Firefox depends on the system.
      </p>
    ) : (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          aria-label="Browser voice"
          value={selected}
          onChange={(e) => {
            choose(e.target.value);
            cancel();
          }}
          className="nx-input min-w-[15rem] max-w-full sm:w-auto"
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
        {!usingHosted && previewButton}
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
    );

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="text-sm font-medium text-neutral-800">Voice</h3>

      {choosable ? (
        <>
          <p className="mt-1 text-xs text-neutral-500">
            The voice Nexus reads replies and your brief in.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              aria-label="Nexus voice"
              value={currentHosted}
              onChange={(e) => {
                const id = e.target.value;
                setHostedVoice(id);
                setStoredHostedVoice(id === hosted?.defaultVoice ? null : id);
                cancel();
              }}
              className="nx-input min-w-[15rem] max-w-full sm:w-auto"
            >
              {hosted?.voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.label} — {voice.note}
                </option>
              ))}
            </select>
            {previewButton}
          </div>
        </>
      ) : usingHosted ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-neutral-500">
            Replies are read with the{" "}
            {hosted?.provider === "elevenlabs" ? "ElevenLabs" : "hosted"} voice
            set up for this app.
          </p>
          {previewButton}
        </div>
      ) : (
        <p className="mt-1 text-xs text-neutral-500">
          Which of your device&apos;s voices Nexus uses. Sorted best-sounding
          first — the top one is what it picks on its own. On a Mac, the
          &ldquo;Premium&rdquo; voices (System Settings → Accessibility → Spoken
          Content → Manage Voices) sound far more natural than the defaults.
        </p>
      )}

      {usingHosted ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowBackup((v) => !v)}
            aria-expanded={showBackup}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
          >
            {showBackup ? "Hide" : "Show"} backup voice
          </button>
          {showBackup && (
            <>
              <p className="mt-1 text-xs text-neutral-500">
                Used only if the voice above can&apos;t be reached.
              </p>
              {browserPicker}
            </>
          )}
        </div>
      ) : (
        browserPicker
      )}

      {!usingHosted && effective && (
        <p className="mt-2 text-xs text-neutral-400">
          Saved on this device only — voices differ from one machine to the next.
        </p>
      )}

      <p className="mt-4 text-xs text-neutral-400">
        Nexus&apos;s voice is AI-generated, not a recording of a real person.
      </p>
    </div>
  );
}
