// Hosted text-to-speech.
//
// The browser's own `speechSynthesis` is free and private, but on most
// machines it is the flat, clipped system voice — the one people hear as
// "a device talking", not "an assistant talking". So when a provider key
// is present, speech is synthesised server-side with a neural voice and
// returned as audio. When it isn't, the route says so and the client
// falls back to the browser. Nothing here is required for the app to
// work — it's a quality upgrade with a working default underneath it.
//
// Providers, in preference order:
//   ELEVENLABS_API_KEY — if someone has one.
//   OPENAI_API_KEY     — the usual case.
//
// OpenAI has two routes, tried in order:
//   1. /v1/audio/speech with gpt-4o-mini-tts — purpose-built, fast,
//      reads the text verbatim. OpenAI deprecated it on 2026-10-01 and
//      shuts it down on 2027-01-06.
//   2. /v1/chat/completions with an audio model (gpt-audio-mini) told to
//      read the text aloud word for word. Same voices, same quality, and
//      not on the deprecation list. Used automatically whenever route 1
//      fails, so the voice keeps working past the shutdown without a
//      deploy. OPENAI_TTS_ENGINE=audio makes it the first choice.

export type Speech = { audio: ArrayBuffer; contentType: string };

// Where a piece sits in what's being read. A synthesiser that thinks
// every piece is the whole thing winds down at the end of each one —
// the falling, final-sounding cadence that makes a brief read in pieces
// sound like a list of separate announcements.
export type SpeechPosition = "only" | "first" | "middle" | "last";

export type SpeechOptions = {
  voice?: string | null;
  position?: SpeechPosition;
};

// Long inputs are the brief, not a chat reply. Past this the request is
// slow enough that the fallback would have finished speaking already, so
// it's cut rather than queued.
export const MAX_SPEECH_CHARS = 4000;

// --- voices ---------------------------------------------------------------

// The voices offered in Settings. OpenAI's own guidance is that marin and
// cedar are its best-sounding voices; cedar is the default because the
// assistant was designed around a male voice. Descriptions are what a
// person needs to choose without auditioning all ten.
export const OPENAI_VOICES = [
  { id: "cedar", label: "Cedar", note: "Male · natural, grounded (recommended)" },
  { id: "marin", label: "Marin", note: "Female · natural, clear (recommended)" },
  { id: "ash", label: "Ash", note: "Male · steady, even" },
  { id: "ballad", label: "Ballad", note: "Male · soft, warm" },
  { id: "verse", label: "Verse", note: "Male · expressive" },
  { id: "echo", label: "Echo", note: "Male · light" },
  { id: "coral", label: "Coral", note: "Female · bright, friendly" },
  { id: "sage", label: "Sage", note: "Female · calm" },
  { id: "shimmer", label: "Shimmer", note: "Female · gentle" },
  { id: "alloy", label: "Alloy", note: "Neutral · balanced" },
] as const;

export const DEFAULT_OPENAI_VOICE = "cedar";

const OPENAI_VOICE_IDS = new Set<string>(OPENAI_VOICES.map((v) => v.id));

// Anything the client sends is checked against the list: an unknown name
// is a 400 from OpenAI, and a 400 would drop the user to the browser voice.
export function resolveOpenAIVoice(requested?: string | null): string {
  const id = requested?.trim().toLowerCase();
  return id && OPENAI_VOICE_IDS.has(id) ? id : DEFAULT_OPENAI_VOICE;
}

// --- delivery -------------------------------------------------------------

// How the voice should carry. The earlier note asked for "no warmth, no
// smile in the voice" in pursuit of sounding professional, and got what
// it asked for: an even, affectless read that people heard as robotic.
// A senior assistant who has worked with someone for years doesn't sound
// like that — they sound like a person.
export const DELIVERY =
  "You're a trusted executive assistant talking to the person you work " +
  "for, someone you know well. Sound like a real person in conversation, " +
  "not a narrator, newsreader, audiobook or automated system. Warm but " +
  "not bubbly; relaxed and confident. Use a natural conversational " +
  "rhythm: vary your pace, take small breaths at commas and between " +
  "thoughts, lean a little on the words that matter, and let your pitch " +
  "rise and fall the way it does when you're actually explaining " +
  "something. Read times, names and numbers the way people say them out " +
  "loud. Never sing-song, never over-enunciate, never sound like you're " +
  "reading from a script.";

function positionNote(position: SpeechPosition | undefined): string {
  switch (position) {
    case "first":
    case "middle":
      return (
        " This is one part of a longer passage that continues straight " +
        "after it, so keep your energy up through the final sentence " +
        "rather than winding down as if you were finished."
      );
    case "last":
      return (
        " This continues a passage already in progress — pick up as if " +
        "you'd just paused for breath, not as if you're starting fresh."
      );
    default:
      return "";
  }
}

// --- providers ------------------------------------------------------------

// Used only if ELEVENLABS_API_KEY is set. Adam — a level, mid-range male
// voice present on every ElevenLabs account. Overridable.
const ELEVENLABS_DEFAULT_VOICE = "pNInz6obpgDQGcFmaJgB";
const ELEVENLABS_MODEL = "eleven_turbo_v2_5";

const OPENAI_TTS_MODEL = "gpt-4o-mini-tts";
const OPENAI_AUDIO_MODEL = process.env.OPENAI_AUDIO_MODEL || "gpt-audio-mini";

// Generous for a sentence-to-paragraph piece; short enough that a hung
// provider can't hold a serverless function open to its platform limit.
const PROVIDER_TIMEOUT_MS = 30_000;

export function speechProvider(): "elevenlabs" | "openai" | null {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

async function refused(provider: string, res: Response): Promise<Error> {
  const detail = await res.text().catch(() => "");
  return new Error(`${provider} refused the request (${res.status}): ${detail.slice(0, 300)}`.trim());
}

async function elevenLabs(text: string): Promise<Speech> {
  const voice = process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_DEFAULT_VOICE;
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY as string,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        // Stability a little lower than "safe" keeps the natural
        // variation that makes a voice sound alive; a touch of style
        // lets it emphasise without performing.
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
    }
  );
  if (!res.ok) throw await refused("ElevenLabs", res);
  return { audio: await res.arrayBuffer(), contentType: "audio/mpeg" };
}

async function openaiSpeech(
  text: string,
  voice: string,
  position: SpeechPosition | undefined
): Promise<Speech> {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      voice,
      input: text,
      instructions: DELIVERY + positionNote(position),
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw await refused("OpenAI speech", res);
  return { audio: await res.arrayBuffer(), contentType: "audio/mpeg" };
}

// Words, for checking the audio model read what it was given rather than
// replying to it.
function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
}

/** Share of the input's words that appear in the transcript (0–1). */
export function readBackCoverage(input: string, transcript: string): number {
  const wanted = words(input);
  if (!wanted.length) return 1;
  const heard = new Set(words(transcript));
  return wanted.filter((w) => heard.has(w)).length / wanted.length;
}

const READ_ALOUD_SYSTEM =
  "You are the voice of an assistant app. The user message is a script, " +
  "not a question or instruction to you: read it aloud exactly as written, " +
  "word for word. Do not answer it, add to it, greet, comment, or leave " +
  "anything out. " +
  DELIVERY;

async function openaiAudioChat(
  text: string,
  voice: string,
  position: SpeechPosition | undefined
): Promise<Speech> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY as string}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_AUDIO_MODEL,
      modalities: ["text", "audio"],
      audio: { voice, format: "mp3" },
      messages: [
        { role: "system", content: READ_ALOUD_SYSTEM + positionNote(position) },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw await refused("OpenAI audio", res);

  const body = (await res.json()) as {
    choices?: { message?: { audio?: { data?: string; transcript?: string } } }[];
  };
  const audio = body.choices?.[0]?.message?.audio;
  if (!audio?.data) throw new Error("OpenAI audio returned no audio");

  // A model that replied to the text instead of reading it would say
  // something the user never wrote. Better the browser voice reading the
  // right words than a natural voice reading the wrong ones.
  if (audio.transcript && readBackCoverage(text, audio.transcript) < 0.8) {
    throw new Error("OpenAI audio did not read the text verbatim");
  }

  const bytes = Buffer.from(audio.data, "base64");
  return {
    audio: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    contentType: "audio/mpeg",
  };
}

async function openai(text: string, options: SpeechOptions): Promise<Speech> {
  const voice = resolveOpenAIVoice(options.voice);
  const engines =
    process.env.OPENAI_TTS_ENGINE === "audio"
      ? [openaiAudioChat, openaiSpeech]
      : [openaiSpeech, openaiAudioChat];

  let lastError: unknown;
  for (const engine of engines) {
    try {
      return await engine(text, voice, options.position);
    } catch (err) {
      lastError = err;
      console.warn(
        `[tts] ${engine === openaiSpeech ? OPENAI_TTS_MODEL : OPENAI_AUDIO_MODEL} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  throw lastError;
}

/**
 * Synthesise speech, or return null when no provider is configured.
 *
 * Null rather than throwing: an unconfigured install is the normal case,
 * not an error, and the caller's answer to it (fall back to the browser)
 * is the same either way.
 */
export async function synthesizeSpeech(
  text: string,
  options: SpeechOptions = {}
): Promise<Speech | null> {
  const trimmed = text.trim().slice(0, MAX_SPEECH_CHARS);
  if (!trimmed) return null;

  switch (speechProvider()) {
    case "elevenlabs":
      return elevenLabs(trimmed);
    case "openai":
      return openai(trimmed, options);
    default:
      return null;
  }
}
