// Hosted text-to-speech.
//
// The browser's own `speechSynthesis` is free and private, but on most
// machines it is the flat, clipped system voice — the one people hear as
// "a device talking", not "an assistant talking". Nexus reads mail and
// calendars aloud; sounding like a 2011 satnav undercuts everything else
// about it.
//
// So: when a provider key is present, speech is synthesised server-side
// with a neural voice and streamed back as audio. When it isn't, the
// route says so and the client falls back to the browser. Nothing here
// is required for the app to work — it's a quality upgrade with a
// working default underneath it.
//
// Two providers, in preference order, because the choice is really a
// question of which key someone already has:
//   ELEVENLABS_API_KEY — best-sounding, and the reason to bother.
//   OPENAI_API_KEY     — nearly as good, cheaper, one fewer signup.

export type Speech = { audio: ArrayBuffer; contentType: string };

// Long inputs are the brief, not a chat reply. Past this the request is
// slow enough that the fallback would have finished speaking already, so
// it's cut rather than queued.
export const MAX_SPEECH_CHARS = 4000;

// How the voice should carry: a senior executive assistant briefing the
// person he works for. Composed and professional rather than friendly —
// the register of someone who has done this every morning for years and
// doesn't need to sell it. Providers that accept a delivery note get
// this one; the rest ignore it.
const DELIVERY =
  "Speak as a senior executive assistant briefing the person he works " +
  "for. Male voice, measured and composed, low-key authority. " +
  "Professional rather than friendly: no warmth in the delivery, no " +
  "brightness at the ends of sentences, no smile in the voice. Let the " +
  "phrasing carry across a comma instead of stopping dead at every " +
  "full stop, and vary the pace so it reads as considered rather than " +
  "recited. Even, unhurried, and never performed.";

// Adam — a level, mid-range male English voice, and one of the handful
// that exists on every ElevenLabs account rather than only in a library
// someone curated. Overridable for anyone who has a voice they prefer.
const ELEVENLABS_DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB";
// eleven_turbo_v2_5 is the latency/quality trade-off that suits a reply
// someone is waiting on; multilingual v2 sounds marginally better and
// takes noticeably longer.
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

// "ash" is the male voice in OpenAI's set with the steadiest, least
// announcer-ish read — "onyx" is deeper but performs, and "echo" is
// thinner. Overridable with OPENAI_TTS_VOICE.
const OPENAI_DEFAULT_VOICE = "ash";
const OPENAI_MODEL = "gpt-4o-mini-tts";

export function speechProvider(): "elevenlabs" | "openai" | null {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

async function elevenLabs(text: string): Promise<Speech> {
  const voice = process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_DEFAULT_VOICE;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY as string,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        // Stability low enough to keep the natural variation that makes
        // a voice sound alive; style at zero because anything above it
        // starts acting. Speaker boost keeps a quiet voice present.
        // A composed read wants more stability than an expressive one —
        // but not so much that every sentence lands with an identical
        // cadence, which is the flat delivery that reads as blocky.
        // Style near zero: this voice reports, it doesn't perform.
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.05,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(
      `ElevenLabs refused the request (${res.status}): ${await res
        .text()
        .catch(() => "")}`.trim()
    );
  }

  return { audio: await res.arrayBuffer(), contentType: "audio/mpeg" };
}

async function openai(text: string): Promise<Speech> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      voice: process.env.OPENAI_TTS_VOICE || OPENAI_DEFAULT_VOICE,
      input: text,
      instructions: DELIVERY,
      response_format: "mp3",
    }),
  });

  if (!res.ok) {
    throw new Error(
      `OpenAI refused the request (${res.status}): ${await res
        .text()
        .catch(() => "")}`.trim()
    );
  }

  return { audio: await res.arrayBuffer(), contentType: "audio/mpeg" };
}

/**
 * Synthesise speech, or return null when no provider is configured.
 *
 * Null rather than throwing: an unconfigured install is the normal case,
 * not an error, and the caller's answer to it (fall back to the browser)
 * is the same either way.
 */
export async function synthesizeSpeech(text: string): Promise<Speech | null> {
  const trimmed = text.trim().slice(0, MAX_SPEECH_CHARS);
  if (!trimmed) return null;

  switch (speechProvider()) {
    case "elevenlabs":
      return elevenLabs(trimmed);
    case "openai":
      return openai(trimmed);
    default:
      return null;
  }
}
