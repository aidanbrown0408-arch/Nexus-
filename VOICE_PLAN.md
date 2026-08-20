# Voice — talking to Nexus, and Nexus talking back

## The problem this solves

Chat already works: you type a question into `ChatSection`, the
`/api/chat` route runs it through Claude with the mail-and-calendar
tools, and the answer comes back with undo receipts attached. But the
moment Nexus is most useful — the first ten minutes of the morning,
coffee in one hand, phone or laptop in the other — is exactly the
moment typing a paragraph into a text box is the wrong interface.
"What's blocking me this week?" is a thing you say, not a thing you
type.

This plan adds two halves of that, deliberately kept separate:

- **Talk to it.** A mic button next to the chat input. Hold or tap,
  speak, your words appear in the input box, you press Send.
- **It talks back.** Assistant replies are read aloud, with a mute
  toggle that sticks.

Both use the browser's own speech APIs — `SpeechRecognition` for the
mic, `speechSynthesis` for the voice. No new API key, no per-minute
cost, no audio ever leaving the user's browser through Nexus's own
servers. That last part matters more than it sounds: this is an app
that reads someone's mail, and "we also stream your microphone to a
third party" is a much bigger ask than "your browser does the
transcription."

## What it is not (on purpose)

**Not hands-free.** No wake word, no auto-send on silence, no
auto-listen after the reply finishes. Push-to-talk into the existing
input box, and you still press Send. This is a deliberate v1 choice,
not an oversight — auto-send means a mis-heard "archive the
newsletters" gets executed before you can look at it, and this chat
route can archive mail and create calendar events. Keeping a human
finger between the transcript and the send button is the whole safety
model for v1.

**Not a new transport.** Voice does not get its own API route, its own
message format, or its own Claude call. It is an input method for the
existing text box and a rendering of the existing text reply. Every
guardrail already in `/api/chat` — the action log, the undo receipts,
the strict `{role, content}` validation — applies unchanged, because
nothing about the request changes.

**Not a voice for the brief.** Reading the morning brief aloud is an
obvious next thing and a genuinely different feature (long-form, a
different place in the app, arguably a different pace of speech). Out
of scope here. If the speaking code is written as a small standalone
hook rather than something tangled into `ChatSection`, the brief can
reuse it later for one screen of work.

## How each half works, conceptually

### Talking to it

`SpeechRecognition` (`webkitSpeechRecognition` in Chrome and Safari)
is a browser object you start and stop. While it runs it fires
`result` events containing interim guesses and, eventually, a final
transcript. The shape of the interaction:

1. Mic button in the chat form, left of the input.
2. Tap it: recognition starts, the button goes to a listening state
   (a filled dot, a subtle pulse — the same visual language as the
   existing thinking dots), and the input's placeholder changes to
   "Listening…".
3. As you speak, interim results write into the input box live, so you
   can see it's hearing you and roughly what it thinks you said.
4. Tap again — or stop talking long enough that the browser ends the
   session on its own — and the final transcript sits in the input
   box, cursor at the end, fully editable.
5. Press Send, exactly as before.

`continuous = false` and `interimResults = true`. Continuous mode is
for dictating documents; for a one-sentence question, letting the
browser decide the utterance ended is the right behavior and gets the
end-of-speech detection for free.

The transcript goes into the *existing* `input` state. That's the
whole integration point on this half — no second field, no separate
"voice message" concept in the transcript, no change to what `send()`
receives.

### It talking back

`speechSynthesis.speak(new SpeechSynthesisUtterance(text))`. Fired
when a new assistant message lands, guarded by a mute toggle.

Three details that are easy to get wrong:

- **Cancel before speaking.** If a previous utterance is still going
  when a new reply arrives, `speechSynthesis.cancel()` first.
  Otherwise they queue and you get the last two answers back to back,
  which sounds broken.
- **Stop on unmount and on navigation.** `speechSynthesis` lives on
  `window`, not in React — it will happily keep talking after the
  component is gone. Cancel in the effect cleanup.
- **Don't speak the receipts.** The action list ("Archived 3
  newsletters", "Undo") is UI, not prose. Speak `message.content`
  only. Reading undo affordances aloud is noise, and the undo button
  is on screen anyway.

Voice selection: take the first `en-*` voice the browser offers and
otherwise let the default stand. Voice quality varies wildly by
platform (macOS Safari's are good, Chrome on Linux's are rough) and
there is no cheap fix for that inside this plan. Rate slightly under
default — around 1.0–1.1 reads better than the sluggish default on
some platforms, worth a listen and a hardcoded constant, not a
setting.

## Browser support, and the honest failure mode

`SpeechRecognition` exists in Chrome, Edge, and Safari. It does not
exist in Firefox. `speechSynthesis` is everywhere.

So: **feature-detect and hide.** If `SpeechRecognition` is undefined,
the mic button simply does not render and chat looks exactly as it
does today. No "your browser doesn't support this" banner on a
feature nobody asked for — a missing button is a better experience
than an error about a button.

The one message that *is* worth showing is the permission denial. If
the user blocks the mic, or has blocked it previously at the browser
level, recognition fires an `error` event with `not-allowed`. That
deserves one line under the input — "Nexus can't hear you — the mic is
blocked for this site in your browser settings" — because the failure
is fixable and the fix isn't obvious. Other error codes (`no-speech`,
`aborted`, `network`) just return to idle silently; they're normal
outcomes of a mic session, not problems.

Chrome's implementation sends audio to Google's servers for
transcription. This is worth a sentence in SETUP.md rather than a
dialog — it's how the platform works, it's the same trade the user
already made by using Chrome's own voice features, and it's a
meaningful difference from "runs entirely on device" that shouldn't be
quietly implied.

## What to build, in order

**1. A `useSpeech` hook, alone, unwired.** `lib/` is server-ish in
this codebase, so this belongs next to the component —
`app/dashboard/useSpeech.ts`, marked client. It exposes
`{ supported, listening, start, stop, error }` for recognition and
`{ speak, cancel, speaking }` for synthesis. Test it against a
throwaway page or a console before touching `ChatSection`, for the
same reason the other plans build screens before data: you want to
know the browser behaves before you have a second thing that could be
at fault.

**2. The mic button.** Wire recognition into `ChatSection`'s existing
`input` state. Nothing speaks yet. Ship-able on its own — dictation
into a chat box is a real improvement even with no voice output, and
it's the half with the harder edge cases.

**3. The speaking half, muted by default.** Add the toggle first,
defaulted off, then the effect that speaks new assistant messages.
Muted-by-default matters: an app that starts talking without being
asked, in an office, is a bad first impression that people fix by
closing the tab.

**4. Persist the toggle.** `user_profile` already exists from the
onboarding work and already carries small preference columns like
`draft_tone` and `weekend_contact`. Add `voice_replies` (boolean,
default false) there and read it the same way. Not localStorage —
this is a preference, and preferences in Nexus live in the profile so
they follow the user across devices. Everything before this step is
per-tab and that's fine for testing, but a toggle that resets on
refresh will be read as a bug.

**5. A line in the settings page.** The re-answer surface from the
onboarding plan (`app/dashboard/settings`) is where this belongs — one
checkbox, "Read replies aloud." No new settings surface.

Steps 1–3 are the feature. Steps 4–5 are what make it not annoying.

## Things that will go wrong (and are fine)

**Transcription will mangle names.** Every person's name in your
inbox, every company, every product. "Draft a reply to Siobhan" is
going to come out wrong, and there is nothing to do about it in v1
except the thing already designed in: the transcript lands in an
editable box and you fix it before sending. This is the strongest
argument for push-to-talk over hands-free, and it will feel like a
limitation for about a week and then feel obviously correct.

**The first tap does nothing.** The browser permission prompt appears
on first use and eats the utterance behind it. Expected. The listening
state should stay on until the user actually gets a result or an
error, so the button doesn't flicker back to idle while the prompt is
still up.

**Long answers are tedious to listen to.** Claude's chat replies are
written to be read, and a six-sentence answer with a bulleted list is
a slog at speech pace. Don't fix this by shortening every reply —
that degrades the text experience for the majority who read it.
Options, later, in order of cost: a stop-speaking button while an
utterance is playing (cheap, do it early if this bites); speaking only
the first paragraph and leaving the rest to be read; a "speak this"
button per message rather than automatic. Watch which one you
actually want before building any of them.

**iOS Safari will be its own thing.** Speech synthesis on iOS requires
a user gesture to unlock audio, so the very first spoken reply after
page load may silently do nothing until something has been tapped.
Since the user has just tapped Send, this mostly works out — but if it
misbehaves on a phone, that's the reason, and the fix is a throwaway
zero-volume utterance on the first user gesture rather than anything
clever.

**Voices sound bad on some platforms.** This is the real ceiling on
the free approach, and there's no getting around it without a hosted
TTS key and a per-minute bill. If the browser voice turns out to be
the thing that makes the feature feel unfinished, that's the
conversation to have — and because the speaking half is a hook with a
`speak(text)` signature, swapping in a hosted voice later is one
file, not a rewrite.

## Why this now

Everything voice depends on already exists. The chat route is built,
the tools are wired, the action log is catching the dangerous calls,
`user_profile` is there to hold the toggle. This is a UI layer on a
working feature, not new machinery — which makes it unusually cheap
for how much it changes the feel of the app.

And it's the first thing on the roadmap that changes *when* Nexus gets
used. Typing is a desk activity. Talking is a walking-to-the-kitchen
activity. That's a different product, reached from here by one hook
and one button.

## What to do next

Write `useSpeech` and confirm the mic actually transcribes in your
browser before touching `ChatSection` — step 1. If recognition
misbehaves, you want to find that out in twenty lines of code, not
tangled into the chat component.
