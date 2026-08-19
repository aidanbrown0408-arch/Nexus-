"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Picking guests by name instead of typing addresses from memory.
//
// Two rules shape this:
//
//   - A typed address always works. Suggestions are a convenience layered
//     on top, never a gate. Someone whose contacts didn't load, or who is
//     inviting a person they've never emailed, types the address and
//     presses Enter exactly as before.
//   - Chosen guests become chips, not text. Once someone is on the list
//     they can be removed with one click and can't be half-deleted into a
//     malformed address by a stray backspace.

export type Guest = {
  name: string;
  email: string;
};

type Props = {
  guests: Guest[];
  onChange: (guests: Guest[]) => void;
  disabled?: boolean;
  disabledHint?: string;
};

const DEBOUNCE_MS = 250;

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function GuestPicker({
  guests,
  onChange,
  disabled,
  disabledHint,
}: Props) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Guest[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const warmed = useRef(false);

  const add = useCallback(
    (guest: Guest) => {
      const email = guest.email.trim().toLowerCase();
      // Silently ignore a repeat rather than showing an error — the user
      // adding someone twice means they want them on the list, and they
      // already are.
      if (!guests.some((g) => g.email.toLowerCase() === email)) {
        onChange([...guests, { name: guest.name.trim() || guest.email, email: guest.email.trim() }]);
      }
      setQuery("");
      setSuggestions([]);
      setHighlight(0);
    },
    [guests, onChange]
  );

  function remove(email: string) {
    onChange(guests.filter((g) => g.email !== email));
  }

  // Google's contact indexes start cold and the first real search comes
  // back empty. One warm-up call on first focus fixes that; the ref makes
  // sure it happens once per mount rather than on every focus.
  function warm() {
    if (warmed.current) return;
    warmed.current = true;
    fetch("/api/contacts?warm=true").catch(() => {});
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/contacts?q=${encodeURIComponent(trimmed)}`,
          { cache: "no-store" }
        );
        const body = await res.json().catch(() => ({ contacts: [] }));
        if (cancelled) return;
        // Anyone already invited is filtered out rather than shown
        // greyed — a list of people you can't pick is just clutter.
        const chosen = new Set(guests.map((g) => g.email.toLowerCase()));
        setSuggestions(
          ((body.contacts ?? []) as Guest[]).filter(
            (c) => !chosen.has(c.email.toLowerCase())
          )
        );
        setHighlight(0);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, guests]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (e.key === "Escape") {
      setSuggestions([]);
      return;
    }
    // Enter and comma both commit. Enter takes the highlighted
    // suggestion when there is one, so the keyboard path never requires
    // reaching for the mouse.
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const picked = suggestions[highlight];
      if (picked) {
        add(picked);
        return;
      }
      const typed = query.trim().replace(/,$/, "");
      if (looksLikeEmail(typed)) add({ name: typed, email: typed });
      return;
    }
    // Backspace on an empty box removes the last chip — the standard
    // behaviour anywhere else chips are used.
    if (e.key === "Backspace" && !query && guests.length) {
      remove(guests[guests.length - 1].email);
    }
  }

  const typedIsAddable = looksLikeEmail(query.trim());

  return (
    <div className="relative mt-2">
      {guests.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {guests.map((guest) => (
            <span
              key={guest.email}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-indigo-50 py-1 pl-2.5 pr-1.5 text-xs text-indigo-900"
            >
              <span className="truncate" title={guest.email}>
                {guest.name}
              </span>
              <button
                type="button"
                onClick={() => remove(guest.email)}
                aria-label={`Remove ${guest.name}`}
                className="shrink-0 rounded-full px-1 text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={warm}
        disabled={disabled}
        placeholder={
          disabled
            ? (disabledHint ?? "Guests unavailable")
            : "Invite someone — name or email"
        }
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-neutral-100 disabled:text-neutral-400"
      />

      {!disabled && (suggestions.length > 0 || typedIsAddable) && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-lg">
          {suggestions.map((contact, i) => (
            <li key={contact.email}>
              <button
                type="button"
                onClick={() => add(contact)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors ${
                  i === highlight ? "bg-indigo-50" : "hover:bg-neutral-50"
                }`}
              >
                <span className="text-sm text-neutral-900">{contact.name}</span>
                {contact.name !== contact.email && (
                  <span className="text-xs text-neutral-500">
                    {contact.email}
                  </span>
                )}
              </button>
            </li>
          ))}

          {/* An address that isn't in contacts is still perfectly
              invitable, so it gets an explicit row rather than the user
              having to guess that Enter will work. */}
          {typedIsAddable &&
            !suggestions.some(
              (s) => s.email.toLowerCase() === query.trim().toLowerCase()
            ) && (
              <li className="border-t border-neutral-100">
                <button
                  type="button"
                  onClick={() =>
                    add({ name: query.trim(), email: query.trim() })
                  }
                  className="w-full px-3 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  Invite <span className="font-medium">{query.trim()}</span>
                </button>
              </li>
            )}
        </ul>
      )}

      {!disabled && searching && query.trim().length >= 2 && (
        <p className="mt-1 text-xs text-neutral-400">Searching contacts…</p>
      )}
    </div>
  );
}
