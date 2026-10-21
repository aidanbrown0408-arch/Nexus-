import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import Logo from "../../Logo";

export const dynamic = "force-dynamic";

// Clerk's hosted sign-up UI. See app/sign-in for why the route is a
// catch-all.
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-[radial-gradient(ellipse_at_top,#EFF4FF,transparent_60%)] px-6 py-12">
      <Link href="/" aria-label="Nexus home">
        <Logo size={32} />
      </Link>
      <SignUp />
      <p className="text-xs text-ink-ghost">
        Connects securely to Gmail and Google Calendar
      </p>
    </main>
  );
}
