import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { synthesizeSpeech, speechProvider, MAX_SPEECH_CHARS } from "@/lib/tts";
import { allowRequest, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Which engine is doing the talking. The settings page asks so it can say
// whether the browser voice list below it is decorative (a hosted voice
// is in use) or the thing that actually matters.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const provider = speechProvider();
  return NextResponse.json({ provider, hosted: provider !== null });
}

// Speech for the client to play.
//
// The provider key stays on the server — the same rule as Anthropic's —
// which is the whole reason this is a route rather than a fetch from the
// component. 501 is the "no key configured" answer, and the client reads
// it as permission to use the browser's own voice instead of showing an
// error for something that isn't broken.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await allowRequest(userId, "speech"))) return rateLimitedResponse();

  if (!speechProvider()) {
    return NextResponse.json(
      { error: "No speech provider configured.", code: "no_provider" },
      { status: 501 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const text = (body as { text?: unknown } | null)?.text;
  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ error: "Nothing to say." }, { status: 400 });
  }
  if (text.length > MAX_SPEECH_CHARS * 2) {
    return NextResponse.json({ error: "Too long to read." }, { status: 413 });
  }

  try {
    const speech = await synthesizeSpeech(text);
    if (!speech) {
      return NextResponse.json(
        { error: "No speech provider configured.", code: "no_provider" },
        { status: 501 }
      );
    }
    return new NextResponse(speech.audio, {
      status: 200,
      headers: {
        "Content-Type": speech.contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // A provider outage shouldn't silence the assistant: the client
    // falls back to the browser voice on any non-OK answer.
    console.error(
      "Speech synthesis failed",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Couldn't synthesise speech.", code: "tts_failed" },
      { status: 502 }
    );
  }
}
