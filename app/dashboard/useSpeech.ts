"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  chunkForSpeech,
  FIRST_CHUNK_CHARS,
  HOSTED_CHUNK_CHARS,
} from "@/lib/speech-text";

// Voice.
//
// `SpeechRecognition` transcribes the mic — in the browser, free, with no
// audio ever passing through Nexus's own servers. Speaking back is a
// choice: `/api/speech` gives a neural voice when a provider key is set,
// and the browser's `speechSynthesis` covers every install that hasn't
// got one.
//
// Two hooks rather than one object, because the halves are independent:
// dictation is useful with the voice muted, and the speaking half is
// where the hosted voice lives.

// --- the bits of the Web Speech API we actually touch -------------------
//
// TypeScript's DOM lib doesn't declare SpeechRecognition (it's still
// prefixed in every shipping browser), so this is the minimum shape the
// code below relies on rather than a full typing of the spec.

type RecognitionAlternative = { transcript: string };
type RecognitionResult = {
  isFinal: boolean;
  0: RecognitionAlternative;
  length: number;
};
type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};
type RecognitionErrorEvent = { error: string };

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

type RecognitionConstructor = new () => Recognition;

function recognitionCtor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// --- dictation ----------------------------------------------------------

export type Dictation = {
  /** False in Firefox, and on the server. The button hides rather than erroring. */
  supported: boolean;
  listening: boolean;
  /** Only set for failures the user can actually do something about. */
  error: string | null;
  start: () => void;
  stop: () => void;
  clearError: () => void;
};

/**
 * Push-to-talk.
 *
 * `onTranscript` fires repeatedly as the browser refines its guess — the
 * caller is expected to overwrite, not append. `final` marks the last one
 * for an utterance.
 */
export function useDictation(
  onTranscript: (text: string, final: boolean) => void
): Dictation {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  // Held in a ref so a re-rendered callback doesn't mean tearing down and
  // rebuilding the recognition object mid-sentence.
  const handlerRef = useRef(onTranscript);
  useEffect(() => {
    handlerRef.current = onTranscript;
  }, [onTranscript]);

  // Detection runs in an effect rather than at render: the server has no
  // window, and a first paint that disagrees with the client is a
  // hydration mismatch.
  useEffect(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang =
      typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
    // One utterance at a time. Continuous mode is for dictating documents;
    // for a one-sentence question, letting the browser decide the sentence
    // ended gives us end-of-speech detection for free.
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event) => {
      let text = "";
      let final = false;
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        text += result[0]?.transcript ?? "";
        if (result.isFinal) final = true;
      }
      handlerRef.current(text.trim(), final);
    };

    recognition.onerror = (event) => {
      // `not-allowed` is the only one worth a message: it's fixable, and
      // the fix (unblock the mic for this site) isn't discoverable. The
      // rest — no-speech, aborted, a flaky network — are ordinary
      // outcomes of a mic session, not problems to report.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError(
          "Nexus can't hear you — the microphone is blocked for this site in your browser settings."
        );
      }
      setListening(false);
    };

    // Fires however the session ended: stopped, timed out, or errored.
    // Clearing the state here rather than in each path is what stops the
    // button sticking in a listening state it can't leave.
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    setSupported(true);

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      try {
        recognition.abort();
      } catch {
        // Aborting one that never started throws in some builds. Nothing
        // to do about it and nothing depending on it.
      }
      recognitionRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setError(null);
    try {
      recognition.start();
      // Optimistic, deliberately: the permission prompt on first use sits
      // in front of `onstart` for as long as the user takes to answer it,
      // and a mic button that looks idle while the browser is asking on
      // its behalf reads as broken.
      setListening(true);
    } catch {
      // Chrome throws InvalidStateError if start() is called twice. The
      // session we wanted is already running, so this is a no-op.
    }
  }, []);

  const stop = useCallback(() => {
    // stop() finishes the utterance and still delivers a final result;
    // abort() would throw the sentence away. Tapping the button to end a
    // sentence should keep the sentence.
    try {
      recognitionRef.current?.stop();
    } catch {
      /* not running */
    }
    setListening(false);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { supported, listening, error, start, stop, clearError };
}

// --- speaking -----------------------------------------------------------

export type Speaker = {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  cancel: () => void;
  /** Call from a user gesture so iOS lets the first real utterance through. */
  prime: () => void;
};

// Two ways to be heard, in preference order.
//
// `/api/speech` returns a neural voice when a provider key is set — the
// difference between an assistant and an appliance, and the only reason
// this hook is more than twenty lines. Everything else here is the
// fallback: the browser's own synthesiser, which is always available,
// costs nothing, and keeps audio off Nexus's servers entirely.
//
// The fallback is not a failure state. An install with no TTS key is the
// normal case, so a 501 from the route is answered by speaking rather
// than by an error.

// Slightly under the platform default. The stock rate reads like an
// announcement; a fraction slower lands closer to someone talking.
const RATE = 0.98;
// A hair below neutral. High-pitched system voices are most of what
// people mean by "it sounds like a robot assistant".
const PITCH = 0.95;

// Not every installed voice is worth using. The system default is
// usually a compact, low-sample-rate voice — and on most machines a
// female one, where the assistant this app is meant to sound like is
// male. So the ranking leads with the best male voices each platform
// ships, and the system default is the last resort rather than the
// first choice.
//
// Scored rather than hard-coded to a name: voice inventories differ by
// OS, browser and locale, and a missing name should cost a point, not
// break the picker.
const PREFERRED_VOICES = [
  // macOS / iOS male voices, best first. The downloadable "Premium"
  // voices are by far the most natural thing a browser can offer.
  "Evan (Premium)",
  "Nathan (Premium)",
  "Tom (Premium)",
  "Jamie (Premium)",
  "Evan (Enhanced)",
  "Nathan (Enhanced)",
  "Daniel",
  "Alex",
  "Tom",
  // Chrome's own, on every platform.
  "Google UK English Male",
  // Windows.
  "Microsoft Andrew Online (Natural)",
  "Microsoft Brian Online (Natural)",
  "Microsoft Guy Online (Natural)",
  "Microsoft Davis Online (Natural)",
  "Microsoft David",
];

// Names that mark the thin, clipped end of the range — the actual source
// of the complaint that a web app "sounds like Siri".
const AVOID =
  /compact|espeak|novelty|eloquence|whisper|zarvox|trinoids|bells|bahh|boing|bubbles|cellos|jester|organ|superstar|wobble|good news|bad news|albert|fred|junior|ralph/i;

export function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name ?? "";
  let score = 0;

  const rank = PREFERRED_VOICES.findIndex(
    (candidate) => name.toLowerCase() === candidate.toLowerCase()
  );
  if (rank >= 0) score += 100 - rank;

  if (/premium|enhanced|natural|neural/i.test(name)) score += 40;
  // Server-side voices are the good ones on Chrome; `localService` marks
  // the built-in set, which is where the tinny voices live.
  if (!voice.localService) score += 15;
  if (AVOID.test(name)) score -= 60;
  if (voice.lang?.toLowerCase().startsWith("en")) score += 10;
  // A tie-break only. Being the platform default is weak evidence of
  // quality and strong evidence of being the voice people are tired of.
  if (voice.default) score += 1;

  return score;
}

// --- the chosen voice ---------------------------------------------------
//
// Kept in localStorage rather than the profile, because the choice is
// only meaningful on the machine that has that voice installed. The same
// account on a Mac and a Windows laptop wants two different answers, and
// a synced preference would give one of them a voice that doesn't exist.
//
// An empty value means "let the scoring decide", which is the default and
// stays the default — this is an override, not a required setup step.

export const STORED_VOICE_KEY = "nexus.voice";
// The hosted (OpenAI) voice. Unlike the browser voice this isn't tied to
// the machine, but it's kept beside it so both choices live in one place
// and need no database change. Empty means the server's default.
export const HOSTED_VOICE_KEY = "nexus.hostedVoice";
// Same-tab notification. `storage` only fires in *other* tabs, so the
// settings page picking a voice wouldn't reach a speaker in the same one.
const VOICE_CHANGED = "nexus:voicechanged";

export function storedVoiceName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORED_VOICE_KEY) || null;
  } catch {
    // Private mode, or storage blocked. Scoring still works.
    return null;
  }
}

export function setStoredVoiceName(name: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (name) window.localStorage.setItem(STORED_VOICE_KEY, name);
    else window.localStorage.removeItem(STORED_VOICE_KEY);
  } catch {
    /* the choice lasts this page load, which is better than an error */
  }
  window.dispatchEvent(new Event(VOICE_CHANGED));
}

export function storedHostedVoice(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(HOSTED_VOICE_KEY) || null;
  } catch {
    return null;
  }
}

export function setStoredHostedVoice(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(HOSTED_VOICE_KEY, id);
    else window.localStorage.removeItem(HOSTED_VOICE_KEY);
  } catch {
    /* lasts this page load */
  }
}

type ChunkPosition = "only" | "first" | "middle" | "last";

function positionOf(index: number, count: number): ChunkPosition {
  if (count <= 1) return "only";
  if (index === 0) return "first";
  return index === count - 1 ? "last" : "middle";
}

/** English voices, best first — the order the picker lists them in. */
export function rankVoices(
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice[] {
  const usable = voices.filter((v) => v.lang);
  const english = usable.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length ? english : usable;
  return [...pool].sort(
    (a, b) => scoreVoice(b) - scoreVoice(a) || a.name.localeCompare(b.name)
  );
}

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

// A frame of silence. Played inside the tap that turns voice on, it buys
// the <audio> element the right to play unprompted later — the same
// unlock the silent utterance buys for speechSynthesis.
const SILENCE =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tAwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7v///////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYaMzt+GAAAAAAAAAAAAAAAAAAAA//sQxAADwAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";

export function useSpeaker(): Speaker {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const primedRef = useRef(false);
  // One element for the life of the hook: on iOS the permission to play
  // belongs to the element that was played during a gesture, so a new
  // Audio per reply would be silent.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Bumped by every speak/cancel. An in-flight synthesis whose token is
  // stale has been superseded and must not start playing over its
  // replacement.
  const tokenRef = useRef(0);
  // Set once the route has answered 501 — no point paying a round trip
  // per reply to be told again that no key is configured.
  const hostedRef = useRef<boolean | null>(null);

  useEffect(() => {
    const speech = synth();
    // Hosted speech alone is enough to call this supported; the browser
    // half is a bonus, not a requirement.
    setSupported(Boolean(speech) || typeof Audio !== "undefined");
    if (!speech) return;

    // Voices load asynchronously in Chrome — the first call returns an
    // empty list and a `voiceschanged` event arrives later. Both paths
    // have to be handled or the voice is whatever the platform defaults
    // to, which is the one we're trying to get away from.
    const pick = () => {
      const ranked = rankVoices(speech.getVoices());
      if (!ranked.length) return;
      // A voice chosen in settings wins outright; the ranking is what
      // decides when nobody has chosen. A stored name that no longer
      // matches anything installed falls back rather than going mute.
      const chosen = storedVoiceName();
      voiceRef.current =
        (chosen && ranked.find((v) => v.name === chosen)) || ranked[0];
    };
    pick();
    speech.addEventListener?.("voiceschanged", pick);
    window.addEventListener(VOICE_CHANGED, pick);
    // Another tab changing it counts too.
    window.addEventListener("storage", pick);

    return () => {
      speech.removeEventListener?.("voiceschanged", pick);
      window.removeEventListener(VOICE_CHANGED, pick);
      window.removeEventListener("storage", pick);
      // speechSynthesis lives on window, not in React. Without this it
      // keeps talking after the component is gone.
      speech.cancel();
    };
  }, []);

  // Everything that could still make noise, stopped.
  const silence = useCallback(() => {
    synth()?.cancel();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      // Leaving a finished src in place means a stray play() replays the
      // last answer.
      audio.removeAttribute("src");
      audio.load();
    }
  }, []);

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    silence();
    setSpeaking(false);
  }, [silence]);

  const prime = useCallback(() => {
    if (primedRef.current) return;
    primedRef.current = true;

    // iOS won't play synthesised speech until something has been spoken
    // inside a user gesture. A silent utterance during the tap that asks
    // for the answer buys the answer itself the right to be heard.
    try {
      const speech = synth();
      if (speech) {
        const utterance = new SpeechSynthesisUtterance("");
        utterance.volume = 0;
        speech.speak(utterance);
      }
    } catch {
      /* nothing to lose */
    }

    // The same unlock, for the hosted path.
    try {
      if (typeof Audio !== "undefined") {
        const audio = audioRef.current ?? new Audio();
        audio.preload = "auto";
        audioRef.current = audio;
        audio.src = SILENCE;
        audio.volume = 0;
        void audio.play()?.catch(() => {});
      }
    } catch {
      /* nothing to lose */
    }
  }, []);

  // The browser's own voice. Always available, and where every failure
  // of the hosted path lands.
  const speakLocally = useCallback((text: string, token: number) => {
    const speech = synth();
    if (!speech) {
      setSpeaking(false);
      return;
    }
    speech.cancel();

    // Queued in pieces rather than spoken as one utterance. Chrome
    // stops reading a long one partway through — a documented bug with
    // no workaround other than not handing it a long one — and a brief
    // is exactly long enough to hit it. Several queued utterances also
    // give `cancel` something to interrupt that isn't a whole minute.
    const chunks = chunkForSpeech(text);
    if (!chunks.length) {
      setSpeaking(false);
      return;
    }

    setSpeaking(true);
    chunks.forEach((chunk, i) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = RATE;
      utterance.pitch = PITCH;
      const last = i === chunks.length - 1;
      const done = () => {
        if (last && tokenRef.current === token) setSpeaking(false);
      };
      utterance.onend = done;
      // One piece failing shouldn't leave the button stuck on "Stop";
      // the queue behind it keeps going either way.
      utterance.onerror = done;
      speech.speak(utterance);
    });
  }, []);

  // One chunk of audio, from the route. Throws on anything but audio,
  // which is how the caller knows to fall back.
  const synthesize = useCallback(
    async (chunk: string, position: ChunkPosition): Promise<string> => {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        // The position lets the voice carry its intonation across a seam
        // instead of winding down at the end of every piece.
        body: JSON.stringify({
          text: chunk,
          position,
          voice: storedHostedVoice(),
        }),
      });

      // 501 is "no key configured", which is a normal install and a
      // permanent answer — stop asking for the rest of the session.
      if (res.status === 501) hostedRef.current = false;
      if (!res.ok) throw new Error(String(res.status));
      hostedRef.current = true;

      return URL.createObjectURL(await res.blob());
    },
    []
  );

  // Play one object URL through to its end. Resolves either way — a
  // piece that won't play is a gap, not a reason to stop the brief.
  const playUrl = useCallback((url: string): Promise<void> => {
    return new Promise<void>((resolve) => {
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.volume = 1;
      audio.src = url;
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        audio.onpause = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      // Stop, or a new brief starting, pauses the element rather than
      // ending it. Without this the loop would sit here forever waiting
      // for an `ended` that is never coming, holding the pieces it had
      // already fetched.
      audio.onpause = done;
      void audio.play().catch(done);
    });
  }, []);

  const speak = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Anything still playing is now the previous answer. Left queued,
      // two replies read back to back sound like a bug.
      tokenRef.current += 1;
      const token = tokenRef.current;
      silence();
      setSpeaking(true);

      // Known to have no provider, or no <audio> to play one with.
      if (hostedRef.current === false || typeof Audio === "undefined") {
        speakLocally(trimmed, token);
        return;
      }

      // A hosted voice renders the whole input before it returns any of
      // it, so asking for a minute of brief in one request means a
      // minute's worth of silence first — long enough that the button
      // reads as broken. So: a short first piece, played the moment it
      // lands, with the next one already being made behind it. What the
      // user waits for is one sentence, not the whole brief.
      const chunks = chunkForSpeech(
        trimmed,
        FIRST_CHUNK_CHARS,
        HOSTED_CHUNK_CHARS
      );
      const count = chunks.length;

      void (async () => {
        // Kept out of the loop's way so a rejection can never surface as
        // an unhandled one while an earlier piece is still playing.
        let ahead: Promise<string | null> | null = chunks.length
          ? synthesize(chunks[0], positionOf(0, count)).catch(() => null)
          : null;

        for (let i = 0; i < chunks.length; i += 1) {
          const current = ahead;
          // Start the next one now, so it is made during this one.
          ahead =
            i + 1 < chunks.length
              ? synthesize(chunks[i + 1], positionOf(i + 1, count)).catch(
                  () => null
                )
              : null;

          const url = await current;

          // Superseded — a new brief, or Stop — while this was rendering.
          if (tokenRef.current !== token) {
            if (url) URL.revokeObjectURL(url);
            void ahead?.then((next) => next && URL.revokeObjectURL(next));
            return;
          }

          if (!url) {
            // A missing key, a provider outage, a browser that refused
            // to play: all the same to the user, who wanted to hear the
            // brief. Say what's left of it in whatever voice remains,
            // starting where the audio stopped rather than from the top.
            void ahead?.then((next) => next && URL.revokeObjectURL(next));
            speakLocally(chunks.slice(i).join(" "), token);
            return;
          }

          await playUrl(url);
          if (tokenRef.current !== token) {
            void ahead?.then((next) => next && URL.revokeObjectURL(next));
            return;
          }
        }

        if (tokenRef.current === token) setSpeaking(false);
      })();
    },
    [silence, speakLocally, synthesize, playUrl]
  );

  return { supported, speaking, speak, cancel, prime };
}

// --- the picker's half --------------------------------------------------

export type VoiceOptions = {
  /** Best first. Empty until the browser has loaded its list. */
  voices: SpeechSynthesisVoice[];
  /** The stored override, or "" for whichever the ranking picks. */
  selected: string;
  /** Name of the voice actually in use, given the current selection. */
  effective: string | null;
  choose: (name: string) => void;
};

/**
 * The installed voices, for a settings UI to list.
 *
 * Separate from `useSpeaker` because the two want different things: the
 * speaker wants one voice and never re-renders when the list changes;
 * the picker wants the whole list and has to re-render when Chrome
 * finally delivers it.
 */
export function useVoiceOptions(): VoiceOptions {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    setSelected(storedVoiceName() ?? "");
    const speech = synth();
    if (!speech) return;
    const load = () => setVoices(rankVoices(speech.getVoices()));
    load();
    speech.addEventListener?.("voiceschanged", load);
    return () => speech.removeEventListener?.("voiceschanged", load);
  }, []);

  const choose = useCallback((name: string) => {
    setSelected(name);
    setStoredVoiceName(name || null);
  }, []);

  const effective =
    (selected && voices.find((v) => v.name === selected)?.name) ||
    voices[0]?.name ||
    null;

  return { voices, selected, effective, choose };
}
