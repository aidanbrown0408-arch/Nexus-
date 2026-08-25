import { redirect } from "next/navigation";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { hasSeenOnboarding } from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";
import Board from "./Board";
import TriageSection from "./TriageSection";
import FiltersSection from "./FiltersSection";

// This page is user-specific (its content depends on who's signed in),
// so it should never be statically prerendered at build time.
export const dynamic = "force-dynamic";

// Server component: middleware.ts already blocks signed-out visitors from
// ever reaching this route, so by the time this renders we know a user
// exists.
export default async function DashboardPage() {
  const { userId } = await auth();

  // First visit goes to the interview instead. The check is on the row
  // existing, not on it being complete — skipping is an answer, and a user
  // who skipped shouldn't be asked again every time they load the page.
  //
  // Resolved before redirecting rather than inside the try: redirect()
  // signals by throwing, so a catch wrapped around it would swallow the
  // navigation. And a failed check falls through to the dashboard — being
  // unable to reach Supabase is a bad reason to withhold someone's mail.
  let seen = true;
  if (userId) {
    try {
      seen = await hasSeenOnboarding(userId);
    } catch (err) {
      console.error("Onboarding check failed", errorMessage(err));
    }
  }
  if (!seen) redirect("/onboarding");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-6">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line py-6">
        <div className="flex items-baseline gap-2.5">
          <span className="text-lg font-semibold tracking-tight">Nexus</span>
          <span className="nx-label whitespace-nowrap">{today}</span>
        </div>

        <div className="flex items-center gap-3.5">
          <nav className="hidden items-center gap-3.5 md:flex">
            <Link
              href="/dashboard/activity"
              className="text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Activity
            </Link>
            <Link
              href="/dashboard/memory"
              className="text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Memory
            </Link>
            <Link
              href="/dashboard/settings"
              className="text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Settings
            </Link>
          </nav>
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { userButtonAvatarBox: "h-8 w-8" } }}
          />
        </div>
      </header>

      {/* The board. Inbox on the left, the assistant in the middle with
          the morning brief folded underneath it, calendar on the right —
          the three-column arrangement from the design canvas. Below the
          lg breakpoint it stacks, assistant first, since on a phone the
          thing you came to do is talk to it. Either side panel can also
          go full screen, which is state Board owns since it has to
          reshape all three columns at once. */}
      <Board />

      {/* Tidying and filters have no home on the canvas board, so they
          live behind a disclosure under it rather than competing with the
          three panels for space. */}
      <details className="group shrink-0 pb-6">
        <summary className="nx-label cursor-pointer list-none text-center transition-colors hover:text-ink">
          Inbox housekeeping
        </summary>
        <div className="flex flex-col items-center gap-4 pt-4">
          <TriageSection />
          <FiltersSection />
        </div>
      </details>
    </main>
  );
}
