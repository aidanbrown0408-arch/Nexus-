// The dashboard's top-level pages, shared by the header nav and the page
// switcher. Which one you're on lives in the URL (?view=…), so Back
// works and the morning brief email can deep-link to ?view=reminders.

export type View = "board" | "email" | "calendar" | "reminders" | "brief";

export const VIEWS: { id: View; label: string }[] = [
  { id: "board", label: "Home" },
  { id: "brief", label: "Brief" },
  { id: "email", label: "Email" },
  { id: "calendar", label: "Calendar" },
  { id: "reminders", label: "Reminders" },
];

const VALID = new Set<string>(VIEWS.map((v) => v.id));

export function parseView(raw: string | null): View {
  return raw && VALID.has(raw) ? (raw as View) : "board";
}

// The board is the default, so it gets the bare path rather than
// ?view=board sitting in the address bar.
export function viewHref(view: View): string {
  return view === "board" ? "/dashboard" : `/dashboard?view=${view}`;
}
