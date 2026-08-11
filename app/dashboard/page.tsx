import { Suspense } from "react";
import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import GmailSection from "./GmailSection";
import CalendarSection from "./CalendarSection";

// This page is user-specific (shows the signed-in user's name), so it
// should never be statically prerendered at build time.
export const dynamic = "force-dynamic";

// Server component: middleware.ts already blocks signed-out visitors from
// ever reaching this route, so by the time this renders we know a user
// exists. currentUser() reads their profile straight from Clerk.
export default async function DashboardPage() {
  const user = await currentUser();

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
        <UserButton
          afterSignOutUrl="/"
          appearance={{ elements: { userButtonAvatarBox: "h-10 w-10" } }}
        />
      </div>

      <Suspense fallback={null}>
        <GmailSection />
      </Suspense>

      <CalendarSection />
    </main>
  );
}
