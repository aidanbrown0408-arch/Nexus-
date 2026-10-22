import type { Metadata } from "next";
import LegalPage from "../LegalPage";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${SITE.name} collects, uses and protects your data.`,
};

// Written to match what the code actually does. If a feature changes what
// is read, stored or sent to a provider, this page changes with it — Google
// checks the policy against the scopes requested during OAuth verification.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        {SITE.name} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is an AI assistant that reads your
        email and calendar so it can brief you, draft replies and manage your
        schedule at your request. This policy explains what we access, why,
        where it goes, and how to remove it. It is operated by {SITE.legalEntity}.
      </p>

      <h2>What we access</h2>
      <ul>
        <li>
          <strong>Account details</strong> — your name and email address, through our
          sign-in provider.
        </li>
        <li>
          <strong>Gmail</strong> — message metadata and content, so we can summarize
          mail, draft replies into your Drafts folder, archive, label or move
          messages to Trash, and create filters, when you ask.
        </li>
        <li>
          <strong>Google Calendar and iCloud Calendar</strong> — your events, so we
          can brief you and create, move or cancel events when you ask. For
          iCloud you provide an app-specific password, which we encrypt.
        </li>
        <li>
          <strong>Google Contacts</strong> — names and email addresses, read-only, to
          suggest guests and recognize people who matter to you.
        </li>
        <li>
          <strong>Your voice</strong> — when you talk to Nexus, your browser turns
          speech into text (Chrome and Edge do this through their own speech
          service); Nexus receives only the text, never audio. Replies read
          aloud are generated as AI speech.
        </li>
        <li>
          <strong>What you tell us</strong> — your onboarding answers, preferences,
          reminders, and chat messages, and short notes Nexus remembers about
          your work (which you can view and delete under Memory).
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to provide the features you use: your morning brief, chat
        answers and actions, reply drafts, inbox cleanup suggestions, meeting
        prep and reminders. We do not sell your data, use it for
        advertising, or use it to build profiles for anyone else.
      </p>
      <p>
        Every action Nexus takes on your mailbox or calendar is logged in your
        Activity page with an undo where one is possible. Nexus never sends an
        email on your behalf — it writes drafts for you to send.
      </p>

      <h2>Google user data — Limited Use</h2>
      <p>
        {SITE.name}&apos;s use and transfer to any other app of information received
        from Google APIs will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We do not use Google user
        data to develop, improve or train generalized AI or machine-learning
        models, and humans do not read it except with your explicit
        permission, where necessary for security, or to comply with law.
      </p>

      <h2>Service providers</h2>
      <p>We share data only with providers that run parts of the service for us:</p>
      <ul>
        <li><strong>Anthropic</strong> (Claude) — processes the email, calendar and chat content needed to answer each request. Data sent through Anthropic&apos;s commercial API is not used to train its models.</li>
        <li><strong>Clerk</strong> — sign-in and account management.</li>
        <li><strong>Supabase</strong> — our database (tokens, preferences, reminders, cached briefs, activity log).</li>
        <li><strong>Vercel</strong> — hosting.</li>
        <li><strong>Resend</strong> — delivers your scheduled morning brief by email, if you turn it on.</li>
        <li><strong>ElevenLabs or OpenAI</strong> — converts replies to speech, if you turn voice on.</li>
      </ul>

      <h2>Storage and security</h2>
      <p>
        Data is encrypted in transit. Google tokens and your iCloud password
        are additionally encrypted at rest with AES-256-GCM. Database access is
        restricted to our servers. We keep a cached copy of each day&apos;s brief
        for that day only, and we do not store copies of your mailbox.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>Disconnect Google or iCloud at any time from the dashboard; this revokes our access.</li>
        <li>View and delete what Nexus remembers on the Memory page.</li>
        <li>
          Delete your account from Settings. This revokes access and permanently
          deletes everything we hold about you.
        </li>
        <li>
          You can also revoke access from your{" "}
          <a href="https://myaccount.google.com/permissions">Google account settings</a>.
        </li>
      </ul>

      <h2>Children</h2>
      <p>{SITE.name} is not intended for anyone under 16, and we do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        If we change this policy in a way that matters, we&apos;ll update the date
        above and tell you in the app or by email before it takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests: <a href={`mailto:${SITE.privacyEmail}`}>{SITE.privacyEmail}</a>.
      </p>
    </LegalPage>
  );
}
