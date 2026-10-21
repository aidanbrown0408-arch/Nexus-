import Link from "next/link";
import Logo from "./Logo";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-6">
      <div className="text-center">
        <Logo size={32} withWordmark={false} className="justify-center" />
        <h1 className="mt-6 text-[24px] font-semibold tracking-tight text-ink">
          That page isn&apos;t here
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          The link may be old, or the page may have moved.
        </p>
        <Link href="/" className="nx-btn-primary nx-btn-sm mt-6 inline-flex">
          Back to Nexus
        </Link>
      </div>
    </main>
  );
}
