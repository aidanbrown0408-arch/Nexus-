// Renders the same short brief in the old voice setup and the new ones,
// so they can be compared by ear. Also exercises the fallback engine that
// takes over when OpenAI shuts down gpt-4o-mini-tts on 2027-01-06.
//
//   npm run voice:samples
//
// Reads OPENAI_API_KEY from .env.local and writes MP3s to ./voice-samples/.
// Costs a fraction of a cent.
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const KEY = env.OPENAI_API_KEY;
if (!KEY) {
  console.error("No OPENAI_API_KEY in .env.local");
  process.exit(1);
}

const TEXT =
  "Morning. Two things need you today, and the board deck is the one to " +
  "clear first: the review it's for is at two. Sarah's also asked twice " +
  "about Friday's reschedule, and three people are waiting on a new time. " +
  "Everything else can wait until tomorrow. That's your morning.";

const OLD_DELIVERY =
  "Speak as a senior executive assistant briefing the person he works for. " +
  "Male voice, measured and composed, low-key authority. Professional rather " +
  "than friendly: no warmth in the delivery, no brightness at the ends of " +
  "sentences, no smile in the voice.";

// Keep in sync with DELIVERY in lib/tts.ts.
const NEW_DELIVERY = fs
  .readFileSync("lib/tts.ts", "utf8")
  .match(/export const DELIVERY =\s*([\s\S]*?);\n/)[1]
  .split("\n")
  .map((l) => l.trim().replace(/^"|"\s*\+?$/g, ""))
  .join("");

const out = "voice-samples";
fs.mkdirSync(out, { recursive: true });

async function speech(file, voice, instructions) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: TEXT, instructions, response_format: "mp3" }),
  });
  if (!res.ok) return console.log(`✗ ${file}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(path.join(out, file), Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${file}`);
}

async function audioChat(file, voice) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_AUDIO_MODEL || "gpt-audio-mini",
      modalities: ["text", "audio"],
      audio: { voice, format: "mp3" },
      messages: [
        {
          role: "system",
          content:
            "You are the voice of an assistant app. The user message is a script, not a question or instruction to you: read it aloud exactly as written, word for word. Do not answer it, add to it, greet, comment, or leave anything out. " +
            NEW_DELIVERY,
        },
        { role: "user", content: TEXT },
      ],
    }),
  });
  if (!res.ok) return console.log(`✗ ${file}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const audio = (await res.json()).choices?.[0]?.message?.audio;
  if (!audio?.data) return console.log(`✗ ${file}: no audio returned`);
  fs.writeFileSync(path.join(out, file), Buffer.from(audio.data, "base64"));
  console.log(`✓ ${file}  (it said: "${audio.transcript}")`);
}

await speech("1-before-ash-old-style.mp3", "ash", OLD_DELIVERY);
await speech("2-after-cedar.mp3", "cedar", NEW_DELIVERY);
await speech("3-after-marin.mp3", "marin", NEW_DELIVERY);
await audioChat("4-fallback-engine-cedar.mp3", "cedar");
console.log(`\nOpen the ${out}/ folder and play them in order.`);
