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
    <main className="mx-auto flex w-full max-w-3xl flex-col px-4 pb-16 pt-10 sm:px-6">

      <header className="border-b border-line pb-6">
        <p className="nx-label-lg">Profile</p>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-ink">
          What Nexus knows about you
        </h1>
      </header>

      <ProfileSettingsForm />
    </main>
  );
}
