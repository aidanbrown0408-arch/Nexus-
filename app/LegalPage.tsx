import Link from "next/link";
import Logo from "./Logo";
import { SITE } from "@/lib/site";

// Shared frame for the privacy policy and terms: plain, readable, and
// linked from the footer and the Google OAuth consent screen.
export default function LegalPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label={`${SITE.name} home`}>
            <Logo size={26} />
          </Link>
          <nav className="flex gap-6 text-[13.5px] text-ink-muted">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-20 pt-12">
        <h1 className="text-[32px] font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-ghost">Effective {SITE.policiesEffective}</p>
        <div className="legal mt-10 space-y-5 text-[15px] leading-relaxed text-ink-body [&_h2]:mt-10 [&_h2]:text-[19px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_a]:text-accent-700 [&_a]:underline">
          {children}
        </div>
      </main>
    </div>
  );
}
