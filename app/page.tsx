import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";

// Public landing page. Signed-out visitors see a "Sign In" button; anyone
// already signed in gets a link straight to their dashboard instead.
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="flex max-w-lg flex-col items-center text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-neutral-900">
          Nexus
        </h1>
        <p className="mt-4 text-lg text-neutral-500">
          Your AI assistant for a calmer inbox and calendar.
        </p>

        <div className="mt-10">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700">
                Sign In
              </button>
            </SignInButton>
          </SignedOut>

          <SignedIn>
            <Link
              href="/dashboard"
              className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
            >
              Go to Dashboard
            </Link>
          </SignedIn>
        </div>
      </div>
    </main>
  );
}
