"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Logo from "../Logo";
import { VIEWS, parseView, viewHref, type View } from "./views";

// One header for every signed-in page.
//
// It used to be two strips on the dashboard (brand + small text links,
// then a tab row), with the Activity / Memory / Settings links hidden
// below md and the sub-pages reachable only by a "Back" button. Now the
// same bar sits on all of them: the dashboard views on the left, the
// account pages on the right, and the current one always highlighted.

const ICONS: Record<View | "activity" | "memory" | "settings", JSX.Element> = {
  board: (
    <path d="M4 5h6v14H4zM14 5h6v6h-6zM14 15h6v4h-6z" />
  ),
  brief: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  reminders: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  memory: (
    <>
      <path d="M12 4.5c-3.5 0-6 2.4-6 5.5 0 1.8.8 3.1 2 4.1V18a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 16 18v-3.9c1.2-1 2-2.3 2-4.1 0-3.1-2.5-5.5-6-5.5Z" />
      <path d="M10 16h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
};

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {ICONS[name]}
    </svg>
  );
}

const PAGES = [
  { id: "activity", href: "/dashboard/activity", label: "Activity" },
  { id: "memory", href: "/dashboard/memory", label: "Memory" },
  { id: "settings", href: "/dashboard/settings", label: "Settings" },
] as const;

function ViewNav({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onDashboard = pathname === "/dashboard";
  const view = parseView(searchParams.get("view"));
  const openCount = useOpenReminderCount(onDashboard ? view : pathname);

  return (
    <nav
      aria-label="Dashboard pages"
      className={`flex items-center gap-1 rounded-xl border border-line bg-surface-muted/80 p-1 ${className}`}
    >
      {VIEWS.map(({ id, label }) => {
        const active = onDashboard && view === id;
        return (
          <Link
            key={id}
            href={viewHref(id)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-[15px] font-medium transition-all duration-150 ${
              active
                ? "bg-white text-ink shadow-tab"
                : "text-ink-muted hover:bg-white/60 hover:text-ink"
            }`}
          >
            <span className={active ? "text-accent-600" : ""}>
              <Icon name={id} />
            </span>
            {label}
            {id === "reminders" && openCount > 0 && (
              <span
                className={`ml-0.5 min-w-[20px] rounded-md px-1.5 text-center text-[11.5px] font-semibold leading-[20px] ${
                  active
                    ? "bg-accent-600 text-white"
                    : "bg-line text-ink-muted"
                }`}
              >
                {openCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function PageLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="flex items-center gap-0.5">
      {PAGES.map(({ id, href, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={id}
            href={href}
            title={label}
            aria-label={label}
            aria-current={active ? "page" : undefined}
            className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-[15px] font-medium transition-colors ${
              active
                ? "bg-accent-50 text-accent-700"
                : "text-ink-muted hover:bg-surface-muted hover:text-ink"
            }`}
          >
            <Icon name={id} />
            <span className="hidden xl:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

// `account` is the Clerk user menu, rendered by the (server) layout and
// passed in — rendering it from this client component caused a
// hydration mismatch.
//
// Below lg this top bar is the navigation. From lg up the sidebar
// (AppSidebar, below) takes over, so this bar is hidden there.
export default function AppHeader({ account }: { account: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/70 lg:hidden">
      <div className="mx-auto flex h-16 w-full items-center gap-4 px-4 sm:px-6">
        <Link
          href="/dashboard"
          className="flex shrink-0 items-center gap-3 rounded-lg"
          aria-label="Nexus home"
        >
          <Logo size={30} />
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Suspense fallback={null}>
            <PageLinks />
          </Suspense>
          <span aria-hidden className="mx-1 h-6 w-px bg-line" />
          {account}
        </div>
      </div>

      <div className="mx-auto w-full overflow-x-auto px-4 pb-3 sm:px-6">
        <Suspense fallback={null}>
          <ViewNav className="w-max" />
        </Suspense>
      </div>
    </header>
  );
}

// --- desktop sidebar ------------------------------------------------------
//
// On a desktop the old centred tab strip hid half the app: Activity,
// Memory and Settings were bare icons until the window was extra-wide,
// and the strip competed with the page for the top of the screen. A
// sidebar puts every destination in one labelled list, always in the
// same place, and gives the board the full height of the window.

const COLLAPSE_KEY = "nexus.sidebar.collapsed";

export function AppSidebar({ account }: { account: React.ReactNode }) {
  // Read after mount so the server render and the first client render
  // agree; storage can be unavailable, which just means "expanded".
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* default */
    }
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* this page load only */
      }
      return next;
    });
  };

  const today = useLocalDate();

  return (
    <aside
      className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface-soft/80 transition-[width] duration-200 lg:flex ${
        collapsed ? "w-[76px]" : "w-[248px]"
      }`}
    >
      <div
        className={`flex h-16 shrink-0 items-center border-b border-line/70 ${
          collapsed ? "justify-center px-2" : "justify-between pl-5 pr-3"
        }`}
      >
        <Link href="/dashboard" aria-label="Nexus home" className="rounded-lg">
          <Logo size={30} withWordmark={!collapsed} />
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={toggle}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-ghost transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <SidebarGlyph />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <Suspense fallback={null}>
          <SidebarNav collapsed={collapsed} />
        </Suspense>
      </div>

      <div className="shrink-0 border-t border-line/70 p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="grid h-9 w-9 place-items-center rounded-lg text-ink-ghost transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <SidebarGlyph flip />
            </button>
            {account}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
            {account}
            <AccountName today={today} />
          </div>
        )}
      </div>
    </aside>
  );
}

function AccountName({ today }: { today: string }) {
  const { user } = useUser();
  const name =
    user?.fullName || user?.primaryEmailAddress?.emailAddress || "Your account";
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[13.5px] font-semibold text-ink">{name}</p>
      <p className="truncate text-[12px] text-ink-ghost">{today || "\u00a0"}</p>
    </div>
  );
}

function SidebarGlyph({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15M15.5 10l-2 2 2 2" />
    </svg>
  );
}

function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onDashboard = pathname === "/dashboard";
  const view = parseView(searchParams.get("view"));
  const openCount = useOpenReminderCount(onDashboard ? view : pathname);

  const section = (label: string) =>
    collapsed ? (
      <div aria-hidden className="mx-auto my-3 h-px w-8 bg-line" />
    ) : (
      <p className="nx-label mb-1.5 mt-5 px-3 first:mt-0">{label}</p>
    );

  const item = (
    key: string,
    href: string,
    label: string,
    icon: keyof typeof ICONS,
    active: boolean,
    badge?: number
  ) => (
    <Link
      key={key}
      href={href}
      scroll={false}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`nx-nav-item ${collapsed ? "justify-center !px-0" : ""}`}
    >
      <span className={active ? "text-accent-600" : "text-ink-ghost"}>
        <Icon name={icon} />
      </span>
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {badge !== undefined && badge > 0 && (
        <span
          className={
            collapsed
              ? "absolute right-2 top-1.5 h-2 w-2 rounded-full bg-accent-600"
              : `min-w-[22px] rounded-md px-1.5 text-center text-[11.5px] font-semibold leading-[20px] ${
                  active ? "bg-accent-600 text-white" : "bg-line text-ink-muted"
                }`
          }
        >
          {collapsed ? null : badge}
        </span>
      )}
    </Link>
  );

  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {section("Workspace")}
      {VIEWS.map(({ id, label }) =>
        item(
          id,
          viewHref(id),
          label,
          id,
          onDashboard && view === id,
          id === "reminders" ? openCount : undefined
        )
      )}
      {section("Nexus")}
      {PAGES.map(({ id, href, label }) =>
        item(id, href, label, id, pathname.startsWith(href))
      )}
    </nav>
  );
}

// Today's date in the *browser's* zone, resolved after mount so it can
// never disagree with what was server-rendered. Empty string until then.
function useLocalDate(): string {
  const [today, setToday] = useState("");
  useEffect(() => {
    setToday(
      new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      })
    );
  }, []);
  return today;
}

// The badge on the Reminders tab. Its own small fetch so the count is
// right on every page; a failure just leaves the badge off. Re-read
// whenever the page changes, so ticking things off and coming back
// doesn't leave a stale number.
function useOpenReminderCount(key: string): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/prep/items", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled || !body?.items) return;
        setCount(
          (body.items as { done: boolean }[]).filter((i) => !i.done).length
        );
      })
      .catch(() => {
        // Leave the badge off.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return count;
}
