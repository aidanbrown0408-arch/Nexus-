"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Voice, using nothing but the browser.
//
// `SpeechRecognition` transcribes the mic; `speechSynthesis` reads text
// aloud. Both ship with Chrome, Edge and Safari, cost nothing, need no
// API key, and — importantly for an app that reads your mail — mean no
// audio ever passes through Nexus's own servers.
//
// Two hooks rather than one object, because the halves are independent:
// dictation is useful with the voice muted, and the speaking half is the
// piece a hosted TTS voice would eventually replace. Keeping `speak(text)`
// as its own small surface is what makes that swap one file instead of a
// rewrite.

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

// A touch above default: the platform defaults read sluggishly, and much
// past this starts sounding clipped.
const RATE = 1.05;

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

export function useSpeaker(): Speaker {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const primedRef = useRef(false);

  useEffect(() => {
    const speech = synth();
    if (!speech) return;
    setSupported(true);

    // Voices load asynchronously in Chrome — the first call returns an
    // empty list and a `voiceschanged` event arrives later. Both paths
    // have to be handled or the voice is whatever the platform defaults
    // to, which on some systems isn't English.
    const pick = () => {
      const voices = speech.getVoices();
      if (!voices.length) return;
      voiceRef.current =
        voices.find((v) => v.lang?.toLowerCase().startsWith("en") && v.default) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ??
        voices[0];
    };
    pick();
    speech.addEventListener?.("voiceschanged", pick);

    return () => {
      speech.removeEventListener?.("voiceschanged", pick);
      // speechSynthesis lives on window, not in React. Without this it
      // keeps talking after the component is gone.
      speech.cancel();
    };
  }, []);

  const cancel = useCallback(() => {
    synth()?.cancel();
    setSpeaking(false);
  }, []);

  const prime = useCallback(() => {
    if (primedRef.current) return;
    const speech = synth();
    if (!speech) return;
    primedRef.current = true;
    // iOS won't play synthesised speech until something has been spoken
    // inside a user gesture. A silent utterance during the tap that asks
    // for the answer buys the answer itself the right to be heard.
    try {
      const silent = new SpeechSynthesisUtterance("");
      silent.volume = 0;
      speech.speak(silent);
    } catch {
      /* nothing to lose */
    }
  }, []);

  const speak = useCallback((text: string) => {
    const speech = synth();
    if (!speech || !text.trim()) return;

    // Anything still playing is now the previous answer. Left queued, two
    // replies read back to back sound like a bug.
    speech.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.rate = RATE;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    speech.speak(utterance);
  }, []);

  return { supported, speaking, speak, cancel, prime };
}
