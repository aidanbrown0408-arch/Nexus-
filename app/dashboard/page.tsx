import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { hasSeenOnboarding } from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";
import DashboardTabs from "./DashboardTabs";

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

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-4 sm:px-6 lg:px-8">
      {/* The tab strip, and whichever page it's on.
          The default is the board: inbox on the left, the assistant in
          the middle with the morning brief folded underneath it, calendar
          on the right — the three-column arrangement from the design
          canvas. Below the lg breakpoint it stacks, assistant first,
          since on a phone the thing you came to do is talk to it. The
          other tabs give one panel the whole width. */}
      <DashboardTabs />

    </main>
  );
}
