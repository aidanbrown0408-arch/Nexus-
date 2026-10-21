import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import Logo from "../../Logo";

export const dynamic = "force-dynamic";

// Clerk's hosted sign-in UI. The [[...sign-in]] catch-all route lets Clerk
// handle its own sub-steps (e.g. password reset, 2FA) under this same path.
export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[radial-gradient(ellipse_at_top,#EFF4FF,transparent_60%)] px-6 py-12">
      <Link href="/" aria-label="Nexus home">
        <Logo size={32} />
      </Link>
      <SignIn />
      <p className="text-xs text-ink-ghost">
        Connects securely to Gmail and Google Calendar
      </p>
    </main>
  );
}
