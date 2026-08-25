import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";
import Orb from "./Orb";

// Public landing page. Signed-out visitors see a "Sign In" button; anyone
// already signed in gets a link straight to their dashboard instead.
const FEATURES = [
  {
    index: "01",
    title: "One morning brief",
    body: "Three things that matter, drawn from mail and calendar together.",
  },
  {
    index: "02",
    title: "Edit in place",
    body:
      "Change a time, approve a reply, cancel a meeting — without leaving the page.",
  },
  {
    index: "03",
    title: "Voice or text",
    body: "Same assistant, one switch. Nothing is voice-only.",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-7 sm:px-10">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[19px] font-semibold tracking-tight">Nexus</span>
          <span className="nx-label">assistant</span>
        </div>

        <div className="flex items-center gap-2.5">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="nx-btn-ghost">Sign in</button>
            </SignInButton>
            <SignInButton mode="modal">
              <button className="nx-btn-primary">Get started</button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <Link href="/dashboard" className="nx-btn-primary">
              Go to dashboard
            </Link>
          </SignedIn>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center px-6 pb-20 text-center sm:px-10">
        <p className="nx-label-lg mb-7">Mail · Calendar · Voice</p>

        <h1 className="text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-display">
          An assistant you can just talk to.
        </h1>

        <p className="mt-5 max-w-[520px] text-lg leading-relaxed text-ink-muted">
          Nexus reads your inbox and calendar, tells you what actually needs you
          today, and handles the replies and the scheduling while you keep
          moving.
        </p>

        <div className="mt-11">
          <Orb mode="idle" />
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="nx-btn-ink px-[26px] py-3.5 text-[15px]">
                Start talking
              </button>
            </SignInButton>
            <SignInButton mode="modal">
              <button className="nx-btn-quiet px-[26px] py-3.5 text-[15px]">
                Type instead
              </button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <Link
              href="/dashboard"
              className="nx-btn-ink px-[26px] py-3.5 text-[15px]"
            >
              Open your dashboard
            </Link>
          </SignedIn>
        </div>

        <div className="mt-16 grid w-full gap-7 border-t border-line pt-7 text-left sm:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.index}>
              <p className="nx-label">{f.index}</p>
              <p className="mt-2 text-[15px] font-medium">{f.title}</p>
              <p className="mt-1 text-sm leading-[1.55] text-ink-muted">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
