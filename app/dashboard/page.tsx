import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";

// This page is user-specific (shows the signed-in user's name), so it
// should never be statically prerendered at build time.
export const dynamic = "force-dynamic";

// Server component: middleware.ts already blocks signed-out visitors from
// ever reaching this route, so by the time this renders we know a user
// exists. currentUser() reads their profile straight from Clerk.
export default async function DashboardPage() {
  const user = await currentUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex w-full max-w-md flex-col items-center rounded-2xl border border-neutral-200 bg-white p-10 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-neutral-900">
          Welcome, {user?.firstName ?? "there"}
        </h1>
        <p className="mt-2 text-sm text-neutral-500">
          This is your Nexus dashboard.
        </p>

        <div className="mt-8">
          <UserButton
            afterSignOutUrl="/"
            appearance={{ elements: { userButtonAvatarBox: "h-10 w-10" } }}
          />
        </div>
      </div>
    </main>
  );
}
