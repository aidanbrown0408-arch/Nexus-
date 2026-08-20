import Link from "next/link";
import MemoryList from "./MemoryList";

export const dynamic = "force-dynamic";

// What Nexus has worked out about you, and a way to take any of it back.
//
// The memory layer is the first thing in this app that writes something
// about the user that the user never said. That's the whole value — a
// brief that knows Marcus is a co-founder reads differently — and it's
// also the thing that turns creepy fastest if it happens off-screen.
// This page is the price of admission for inferring anything at all.
export default function MemoryPage() {
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
          What Nexus remembers
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Things Nexus worked out from your mail and calendar, and now
          reads back into every brief and answer. Delete anything that is
          wrong, or that you would rather it did not keep.
        </p>
      </header>

      <MemoryList />
    </main>
  );
}
