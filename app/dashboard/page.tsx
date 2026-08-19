import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { currentUser, auth } from "@clerk/nextjs/server";
import { hasSeenOnboarding } from "@/lib/profile";
import { errorMessage } from "@/lib/supabase";
import BriefSection from "./BriefSection";
import ChatSection from "./ChatSection";
import GmailSection from "./GmailSection";
import TriageSection from "./TriageSection";
import FiltersSection from "./FiltersSection";
import CalendarSection from "./CalendarSection";

// This page is user-specific (shows the signed-in user's name), so it
// should never be statically prerendered at build time.
export const dynamic = "force-dynamic";

// Server component: middleware.ts already blocks signed-out visitors from
// ever reaching this route, so by the time this renders we know a user
// exists. currentUser() reads their profile straight from Clerk.
export default async function DashboardPage() {
  const user = await currentUser();
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
    <main className="flex min-h-screen flex-col items-center px-6 py-12">
      <div className="flex w-full max-w-2xl items-center justify-between rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Welcome, {user?.firstName ?? "there"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            This is your Nexus dashboard.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/settings"
            className="text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-800"
          >
            What Nexus knows about you
          </Link>
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { userButtonAvatarBox: "h-10 w-10" } }}
          />
        </div>
      </div>

      <BriefSection />

      <ChatSection />

      <Suspense fallback={null}>
        <GmailSection />
      </Suspense>

      {/* Tidy up before Filters: archiving is the reversible, one-off
          version of the same instinct, and it's the one most people
          should reach for first. */}
      <TriageSection />

      <FiltersSection />

      <CalendarSection />
    </main>
  );
}
