import Link from "next/link";
import ActivityList from "./ActivityList";

export const dynamic = "force-dynamic";

// Everything Nexus has done, and a way to put any of it back.
//
// The action log has always recorded this and /api/actions/[id]/undo has
// always been able to reverse it — but with no page, the log was a table
// nobody could look at and the undo needed an id and a curl.
//
// It matters more now than when the log was written. Actions used to come
// from buttons the user clicked, so they always knew what had happened.
// Chat can change three things from one sentence, and a conversation
// scrolls away.
export default function ActivityPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-12">
      <Link
        href="/dashboard"
        className="nx-btn-quiet nx-btn-sm self-start"
      >
        ← Back to dashboard
      </Link>

      <header className="mt-7">
        <p className="nx-label-lg">Action log</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          What Nexus has done
        </h1>
        <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-ink-muted">
          Every change made on your behalf, newest first. Anything
          reversible can be put back from here.
        </p>
      </header>

      <ActivityList />
    </main>
  );
}
