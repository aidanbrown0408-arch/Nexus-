import Link from "next/link";
import ProfileSettingsForm from "./ProfileSettingsForm";

export const dynamic = "force-dynamic";

// Everything the onboarding interview asked, editable at any time.
//
// Unlike /onboarding, there's no redirect guard here and no notion of
// "already seen" — this page works identically for someone who finished
// the interview, someone who skipped it, and someone who signed up before
// it existed and has no row at all. The form just starts blank for that
// last group, and saving creates their row for the first time. That's
// also what quietly marks them "seen" going forward, so they won't get
// redirected into the wizard the next time they hit the dashboard —
// having used settings is a fine substitute for having used the wizard.
export default function ProfileSettingsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-12">
      <Link href="/dashboard" className="nx-btn-quiet nx-btn-sm self-start">
        ← Back to dashboard
      </Link>

      <header className="mt-7">
        <p className="nx-label-lg">Profile</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
          What Nexus knows about you
        </h1>
      </header>

      <ProfileSettingsForm />
    </main>
  );
}
