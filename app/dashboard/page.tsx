import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import Inbox from "./inbox";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await currentUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="flex w-full max-w-md items-center justify-between rounded-2xl border border-neutral-200 bg-white p-10 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Welcome, {user?.firstName ?? "there"}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">
            This is your Nexus dashboard.
          </p>
        </div>

        <UserButton
          afterSignOutUrl="/"
          appearance={{ elements: { userButtonAvatarBox: "h-10 w-10" } }}
        />
      </div>

      <Inbox />
    </main>
  );
}
