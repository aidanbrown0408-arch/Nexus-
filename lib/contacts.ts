import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

// Looking people up so guests can be picked rather than typed.
//
// Two sources, and the second is the one that matters. `people.connections`
// is the saved address book, which for most people is small and stale.
// `otherContacts` is everyone they've emailed without ever saving —
// which is where the colleague they meet with weekly actually lives.
// Searching only the address book would produce a picker that confidently
// knows almost nobody.
//
// Read-only throughout. Nexus never writes to a contact.

export type Contact = {
  name: string;
  email: string;
};

const MAX_RESULTS = 8;

// Structural, and deliberately narrower than googleapis' Schema$Person:
// only the two fields the readMask actually asks for. Declaring it this
// way rather than importing the generated type keeps the optional/null
// mismatch between the two search endpoints from leaking out.
type PersonLike = {
  names?: { displayName?: string | null }[];
  emailAddresses?: { value?: string | null }[];
};

// One person can carry several addresses; each becomes its own suggestion
// so picking "work" vs "personal" is possible. A person with no address
// is dropped — there's nothing to invite.
function toContacts(people: (PersonLike | undefined)[]): Contact[] {
  const out: Contact[] = [];

  for (const person of people) {
    if (!person) continue;
    const name = person.names?.[0]?.displayName?.trim() ?? "";
    for (const entry of person.emailAddresses ?? []) {
      const email = entry.value?.trim();
      if (!email) continue;
      out.push({ name: name || email, email });
    }
  }

  return out;
}

// Same address can come back from both the address book and the
// previously-emailed list. Dedupe on the address, keeping the first —
// which is the saved contact, and therefore the better name.
function dedupe(contacts: Contact[]): Contact[] {
  const seen = new Set<string>();
  const out: Contact[] = [];

  for (const contact of contacts) {
    const key = contact.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(contact);
  }

  return out;
}

// Search both sources for `query`.
//
// Google's search endpoints are warm-cache based: the first call after a
// while can return nothing while the index warms up. That's why an empty
// result is returned rather than treated as an error — the picker still
// accepts a typed address, so "no suggestions" degrades to the behaviour
// this feature replaced rather than to a failure.
export async function searchContacts(
  client: OAuth2Client,
  query: string
): Promise<Contact[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const people = google.people({ version: "v1", auth: client });

  // One failing source shouldn't cost the other. Someone who granted
  // contacts but not other-contacts should still get their address book.
  const [saved, other] = await Promise.allSettled([
    people.people.searchContacts({
      query: trimmed,
      pageSize: MAX_RESULTS,
      readMask: "names,emailAddresses",
    }),
    people.otherContacts.search({
      query: trimmed,
      pageSize: MAX_RESULTS,
      readMask: "names,emailAddresses",
    }),
  ]);

  const results: Contact[] = [];

  if (saved.status === "fulfilled") {
    results.push(
      ...toContacts((saved.value.data.results ?? []).map((r) => r.person))
    );
  } else {
    console.error("Contact search (saved) failed", saved.reason);
  }

  if (other.status === "fulfilled") {
    results.push(
      ...toContacts((other.value.data.results ?? []).map((r) => r.person))
    );
  } else {
    console.error("Contact search (other) failed", other.reason);
  }

  return dedupe(results).slice(0, MAX_RESULTS);
}

// Google's search indexes are built per-session and start cold: the first
// searchContacts call after a gap often returns nothing at all. Google's
// documented fix is to send an empty query once to warm it, which is what
// this does. Fire-and-forget — a failure here just means the first real
// search is emptier than it should be, which the UI already handles.
export async function warmContactCache(client: OAuth2Client): Promise<void> {
  const people = google.people({ version: "v1", auth: client });
  await Promise.allSettled([
    people.people.searchContacts({ query: "", pageSize: 1, readMask: "names" }),
    people.otherContacts.search({ query: "", pageSize: 1, readMask: "names" }),
  ]);
}
