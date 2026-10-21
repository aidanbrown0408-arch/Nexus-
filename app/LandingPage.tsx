import Logo from "./Logo";
import Orb from "./Orb";

// The public landing page, as pure presentation.
//
// The call-to-action buttons are slots rather than imports because they
// are Clerk components, and Clerk needs its own script to resolve
// <SignedIn> / <SignedOut> before it will render anything at all. Keeping
// them out here means this file is the design and nothing else: it can be
// rendered, looked at and iterated on without an auth provider in the
// loop, the same reason the dashboard layout passes the user menu into
// AppHeader instead of rendering it there.
//
// On the design: the thing that makes Nexus sellable is not that it reads
// your mail — everything reads your mail — it is that every change it
// makes is reversible and written down, and that the permissions it asks
// for stop deliberately short of the dangerous ones. That is a real
// property of this codebase (lib/google.ts asks for gmail.compose and
// pointedly not gmail.send; lib/actions.ts logs every write with its own
// undo), so the page is built around it. The hero shows the product's
// actual output rather than an abstraction, and the one loud moment on
// the page is the band that lays out what Nexus can and cannot do.

type Props = {
  /** Sign-in affordance for the header. */
  headerSignIn: React.ReactNode;
  /** Primary header button. */
  headerStart: React.ReactNode;
  /** The main call to action in the hero. */
  heroPrimary: React.ReactNode;
  /** The quieter companion to it. */
  heroSecondary: React.ReactNode;
  /** The closing call to action at the foot of the page. */
  closingCta: React.ReactNode;
};

const CAPABILITIES = [
  "Draft a reply in your Gmail drafts, ready for you to read",
  "Archive and label mail, one message or a whole backlog",
  "Move mail to Trash, where Gmail keeps it for 30 days",
  "Create, move and cancel calendar events",
  "Set up Gmail filters for mail that hasn't arrived yet",
];

const LIMITS = [
  "Send an email. It writes drafts; you press send",
  "Delete anything permanently. Everything lands in Trash first",
  "Invite guests to a meeting from chat — that needs you on the page",
  "Change anything without logging it, with an undo attached",
];

export default function LandingPage({
  headerSignIn,
  headerStart,
  heroPrimary,
  heroSecondary,
  closingCta,
}: Props) {
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-[72px] w-full max-w-[1160px] items-center justify-between gap-4 px-6 sm:px-10">
          <Logo size={30} />
          <div className="flex items-center gap-2">
            {headerSignIn}
            {headerStart}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero. Left-aligned and asymmetric: the argument on the left,
            the thing itself on the right. */}
        <section className="mx-auto w-full max-w-[1160px] px-6 pb-20 pt-14 sm:px-10 sm:pt-20">
          <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
            <div>
              <h1 className="max-w-[18ch] text-[clamp(2.5rem,5.4vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.035em] text-ink">
                An assistant that has already read your inbox.
              </h1>

              <p className="mt-7 max-w-[54ch] text-[17px] leading-[1.65] text-ink-muted">
                Nexus goes through your mail and calendar before you do, tells
                you the few things that actually need you today, and handles
                the replies and the scheduling on your say-so.
              </p>

              <div className="mt-9 flex flex-wrap items-center gap-3">
                {heroPrimary}
                {heroSecondary}
              </div>

              <p className="mt-6 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-ghost">
                Connects to Gmail and Google Calendar, and to iCloud Calendar
                if you use it. No card needed to start.
              </p>
            </div>

            <BriefPreview />
          </div>
        </section>

        {/* What it does. Three things, given room to be specific — a
            feature is only persuasive if it says what actually happens. */}
        <section id="what-it-does" className="border-t border-line bg-white">
          <div className="mx-auto w-full max-w-[1160px] px-6 py-20 sm:px-10">
            <h2 className="max-w-[26ch] text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[34px]">
              Three things, and it does them properly.
            </h2>

            <dl className="mt-14 grid gap-x-12 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
              <div className="border-t-2 border-ink pt-5">
                <dt className="text-[17px] font-semibold text-ink">
                  One brief, not an inbox
                </dt>
                <dd className="mt-3 text-[15px] leading-[1.6] text-ink-muted">
                  Every morning, the handful of things that need a decision —
                  drawn from your mail and your calendar together, so a
                  message about Thursday&apos;s meeting arrives next to the
                  meeting. It names the person and the deadline rather than
                  summarising your subject lines back at you.
                </dd>
              </div>

              <div className="border-t-2 border-ink pt-5">
                <dt className="text-[17px] font-semibold text-ink">
                  It acts, and you can take it back
                </dt>
                <dd className="mt-3 text-[15px] leading-[1.6] text-ink-muted">
                  Ask it to clear the newsletters or reply to Sarah and it
                  does, then writes down what it did with an undo next to it.
                  Nothing it touches is unrecoverable, which is the only
                  reason it&apos;s safe to let it touch anything.
                </dd>
              </div>

              <div className="border-t-2 border-ink pt-5">
                <dt className="text-[17px] font-semibold text-ink">
                  Talk to it, or type
                </dt>
                <dd className="mt-3 text-[15px] leading-[1.6] text-ink-muted">
                  The same assistant either way, with the same answers and the
                  same actions. Nothing is voice-only and nothing is hidden
                  behind a microphone — read the brief at your desk, ask it
                  about your afternoon on the way out.
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* The one loud moment on the page. A business handing over its
            mailbox wants the boundary stated, not implied. */}
        <section className="bg-ink text-white">
          <div className="mx-auto w-full max-w-[1160px] px-6 py-20 sm:px-10">
            <div className="max-w-[60ch]">
              <h2 className="text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[34px]">
                What it&apos;s allowed to do, and what it isn&apos;t.
              </h2>
              <p className="mt-5 text-[16px] leading-[1.65] text-white/65">
                Nexus asks for the narrowest Google permissions that let it be
                useful, and deliberately skips the ones it would be hard to
                recover from. This is the whole list.
              </p>
            </div>

            <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:gap-16">
              <div>
                <h3 className="pb-4 text-[15px] font-semibold text-white">
                  It can
                </h3>
                <ul className="border-t border-white/15">
                  {CAPABILITIES.map((item) => (
                    <li
                      key={item}
                      className="flex gap-3.5 border-b border-white/10 py-4 text-[15px] leading-[1.5] text-white/85"
                    >
                      <CheckMark />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="pb-4 text-[15px] font-semibold text-white">
                  It cannot
                </h3>
                <ul className="border-t border-white/15">
                  {LIMITS.map((item) => (
                    <li
                      key={item}
                      className="flex gap-3.5 border-b border-white/10 py-4 text-[15px] leading-[1.5] text-white/85"
                    >
                      <NoMark />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <p className="mt-10 max-w-[64ch] text-[14px] leading-relaxed text-white/50">
              You can disconnect your account at any time, which revokes
              everything above at once. Every change Nexus has made stays
              listed on your activity page so you can see what it did while it
              was connected.
            </p>
          </div>
        </section>

        {/* Close. */}
        <section className="border-t border-line bg-white">
          <div className="mx-auto w-full max-w-[1160px] px-6 py-20 text-center sm:px-10">
            <h2 className="mx-auto max-w-[22ch] text-[30px] font-semibold leading-[1.15] tracking-[-0.02em] text-ink sm:text-[34px]">
              Read one brief and see if it&apos;s right.
            </h2>
            <p className="mx-auto mt-5 max-w-[48ch] text-[16px] leading-[1.65] text-ink-muted">
              Connect your mail and Nexus will have your first brief ready in
              about twenty seconds.
            </p>
            <div className="mt-9 flex justify-center">{closingCta}</div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto flex w-full max-w-[1160px] flex-col items-start justify-between gap-6 px-6 py-10 sm:flex-row sm:items-center sm:px-10">
          <div className="flex items-center gap-3">
            <Logo size={24} withWordmark={false} />
            <p className="text-[13.5px] text-ink-ghost">
              Nexus &copy; {year}
            </p>
          </div>
          <nav aria-label="Footer" className="flex items-center gap-7 text-[13.5px]">
            <a
              href="mailto:hello@nexus.app"
              className="text-ink-muted transition-colors hover:text-ink"
            >
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

// The hero artifact: the product's own output, built in markup rather
// than pasted in as a screenshot, so it stays crisp, stays truthful to
// the real components' styling, and can be read by a screen reader.
//
// The content is illustrative and says so — a landing page that showed a
// real inbox would be a different and much worse idea.
function BriefPreview() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="absolute -inset-x-6 -inset-y-8 -z-10 rounded-[32px] bg-gradient-to-b from-accent-100/70 via-accent-50/40 to-transparent blur-2xl"
      />

      <figure className="overflow-hidden rounded-panel border border-line bg-white shadow-pop">
        <div className="flex items-center gap-3 border-b border-line bg-surface-soft px-5 py-4">
          <Orb mode="idle" size={34} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-ink">
              Thursday brief
            </p>
            <p className="text-[12.5px] text-ink-ghost">
              Across your mail and calendar
            </p>
          </div>
        </div>

        <div className="px-5 py-5">
          <p className="text-[15px] font-medium text-ink">
            Two things need you today.
          </p>
          <p className="mt-2 text-[14px] leading-[1.55] text-ink-muted">
            The board deck is still unsent and the meeting it&apos;s for is at
            two. Everything else can wait until tomorrow.
          </p>

          <ul className="mt-5 flex flex-col gap-3">
            <PreviewPriority
              title="Send the board deck"
              reason="Asked for it twice; the review is at 2:00"
              tag="Mail"
            />
            <PreviewPriority
              title="Confirm Friday's reschedule"
              reason="Three guests are waiting on a new time"
              tag="Calendar"
            />
          </ul>

          {/* The action log, which is the actual argument. Mono here
              because these are timestamps in a record, which is what
              that typeface is for. */}
          <div className="mt-6 rounded-well border border-line-soft bg-surface-soft px-4 py-3.5">
            <p className="text-[12.5px] font-medium text-ink-body">
              What Nexus did this morning
            </p>
            <ul className="mt-3 flex flex-col gap-2.5">
              <PreviewAction time="08:41" label="Drafted a reply to Sarah" />
              <PreviewAction time="08:41" label="Archived 14 newsletters" />
            </ul>
          </div>
        </div>

        <figcaption className="border-t border-line-soft bg-surface-soft px-5 py-3 text-[12px] text-ink-wisp">
          An example brief. Yours is built from your own mail and calendar.
        </figcaption>
      </figure>
    </div>
  );
}

function PreviewPriority({
  title,
  reason,
  tag,
}: {
  title: string;
  reason: string;
  tag: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-line-soft px-3.5 py-3">
      <span
        aria-hidden
        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-accent-600"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-ghost">
          {reason}
        </p>
      </div>
      <span className="shrink-0 rounded-md bg-surface-muted px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
        {tag}
      </span>
    </li>
  );
}

function PreviewAction({ time, label }: { time: string; label: string }) {
  return (
    <li className="flex items-center gap-3 text-[13px]">
      <span className="font-mono text-[11.5px] text-ink-wisp">{time}</span>
      <span className="min-w-0 flex-1 truncate text-ink-body">{label}</span>
      <span className="shrink-0 font-medium text-accent-700">Undo</span>
    </li>
  );
}

function CheckMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      className="mt-[3px] shrink-0"
    >
      <circle cx="10" cy="10" r="9" fill="rgba(255,255,255,.12)" />
      <path
        d="m6 10.3 2.6 2.6L14 7.5"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NoMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
      className="mt-[3px] shrink-0"
    >
      <circle cx="10" cy="10" r="9" fill="rgba(255,255,255,.07)" />
      <path
        d="M6.8 10h6.4"
        stroke="rgba(255,255,255,.75)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
