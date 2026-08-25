import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

// Clerk's hosted sign-up UI. See app/sign-in for why the route is a
// catch-all.
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6">
      <div className="flex items-baseline gap-2.5">
        <span className="text-[19px] font-semibold tracking-tight">Nexus</span>
        <span className="nx-label">assistant</span>
      </div>
      <SignUp />
    </main>
  );
}
