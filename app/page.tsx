import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";
import LandingPage from "./LandingPage";

// Public landing page. The design lives in ./LandingPage; this file does
// nothing but decide what the buttons are, which depends on whether the
// visitor is already signed in. Signed-out visitors get Clerk's modal;
// anyone with a session gets a link straight to their dashboard.
export default function Home() {
  return (
    <LandingPage
      headerSignIn={
        <>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="nx-btn-ghost nx-btn-sm">Sign in</button>
            </SignInButton>
          </SignedOut>
        </>
      }
      headerStart={
        <>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="nx-btn-primary nx-btn-sm">Get started</button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard" className="nx-btn-primary nx-btn-sm">
              Go to dashboard
            </Link>
          </SignedIn>
        </>
      }
      heroPrimary={
        <>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="nx-btn-ink px-6 py-3.5 text-[15px]">
                Connect your Gmail
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="nx-btn-ink px-6 py-3.5 text-[15px]"
            >
              Open your dashboard
            </Link>
          </SignedIn>
        </>
      }
      heroSecondary={
        <a href="#what-it-does" className="nx-btn-quiet px-6 py-3.5 text-[15px]">
          See what it does
        </a>
      }
      closingCta={
        <>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="nx-btn-ink px-7 py-3.5 text-[15px]">
                Connect your Gmail
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="nx-btn-ink px-7 py-3.5 text-[15px]"
            >
              Open your dashboard
            </Link>
          </SignedIn>
        </>
      }
    />
  );
}
