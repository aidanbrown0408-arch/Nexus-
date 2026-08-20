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
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-12">
      <Link
        href="/dashboard"
        className="text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-800"
      >
        ← Back to dashboard
      </Link>

      <header className="mt-6">
        <h1 className="text-2xl font-semibold text-neutral-900">
          What Nexus has done
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Every change made on your behalf, newest first. Anything
          reversible can be put back from here.
        </p>
      </header>

      <ActivityList />
    </main>
  );
}
