# Google integration setup

Follow these steps once before running the app. Both Supabase and Google
Cloud Console need a bit of configuration.

Google tokens live in one `google_tokens` table and are shared by every
Google API the app talks to (Gmail today, more later), so this setup is
done once rather than per-API.

## 1. Supabase

### 1a. Create the tokens table

Open your Supabase project → **SQL Editor** → **New query**, paste the
following, and run it:

```sql
create table if not exists public.google_tokens (
  user_id       text primary key,
  access_token  text not null,
  refresh_token text,
  token_expiry  timestamptz,
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.google_tokens enable row level security;

-- We authenticate with Clerk, not Supabase Auth, and only ever touch this
-- table from server routes using the service role key. RLS is enabled so
-- that anon/authenticated roles can't read tokens even by mistake — the
-- service role key bypasses RLS on purpose.
```

`user_id` stores the Clerk user id (e.g. `user_2abc...`) — it is `text`,
not `uuid`, because Clerk ids are prefixed strings.

### 1a-bis. Already have a `gmail_tokens` table?

If you set this project up before the table was generalized, rename it
in place rather than recreating it — this preserves existing rows, so
connected users stay connected:

```sql
alter table public.gmail_tokens rename to google_tokens;
alter table public.google_tokens enable row level security;
```

### 1b. Grab the environment variables

In Supabase → **Project Settings** → **API**, copy:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **`service_role` secret** → `SUPABASE_SERVICE_ROLE_KEY`
  (Server-only. Never expose it to the browser.)

## 2. Google Cloud Console

### 2a. Create / pick a project

Go to <https://console.cloud.google.com/> and either select an existing
project or create a new one (top-left project dropdown → **New project**).

### 2b. Enable the Google APIs

- Navigation menu → **APIs & Services** → **Library**
- Search for **Gmail API**, open it, click **Enable**.
- Do the same for **Google Calendar API**.

### 2c. Configure the OAuth consent screen

- **APIs & Services** → **OAuth consent screen**
- User type: **External** (unless you're on a Workspace org that wants
  Internal).
- App name: `Nexus` (anything you like), user support email, developer
  contact email. Save & continue.
- **Scopes**: click **Add or remove scopes** and add:
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/calendar.readonly`
- **Test users**: while the app is in Testing mode, add your own Google
  account (and anyone else who'll test) here. Save.

### 2d. Create the OAuth client

- **APIs & Services** → **Credentials** → **Create credentials** →
  **OAuth client ID**
- Application type: **Web application**
- Name: `Nexus web`
- **Authorized JavaScript origins**:
  - `http://localhost:3000`
  - (add your production origin later, e.g. `https://your-domain.com`)
- **Authorized redirect URIs**:
  - `http://localhost:3000/api/google/callback`
  - (add the production equivalent later, e.g.
    `https://your-domain.com/api/google/callback`)
- Create. Copy the **Client ID** and **Client secret**.

## 3. Environment variables

Copy `.env.local.example` to `.env.local` and fill in the highlighted
lines:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...          # from step 1b
SUPABASE_SERVICE_ROLE_KEY=...         # from step 1b (server-only)

# Google OAuth
GOOGLE_CLIENT_ID=...                  # from step 2d
GOOGLE_CLIENT_SECRET=...              # from step 2d
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/callback

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

`GOOGLE_REDIRECT_URI` must match one of the Authorized redirect URIs on
the OAuth client exactly, path included. Google rejects the connect flow
with `redirect_uri_mismatch` otherwise.

Restart the dev server after editing `.env.local`.

## 4. Try it

1. `npm run dev`
2. Sign in, visit `/dashboard`.
3. Click **Connect Gmail** — you'll be sent to Google, grant permission,
   and land back on the dashboard.
4. Your 20 most recent emails should appear, and your next 7 days of
   events below them. Use **Refresh** on either card to re-fetch.

If Google returns `access_denied`, the app will show a friendly banner
instead of crashing. Same for any Gmail or Calendar API failure at fetch
time.

## 5. Re-consenting after a scope change

Google grants scopes at connect time and bakes them into the stored
token. Adding a scope to `GOOGLE_SCOPES` does **not** widen a token that
already exists — anyone connected before the change keeps the narrower
grant until they go through consent again.

Calendar was added after Gmail, so every account connected before then
is in exactly this position. The app detects it: `/api/calendar/events`
checks the stored scope string before calling Google and returns
`code: "scope_missing"`, which the dashboard renders as a **Reconnect to
enable Calendar** prompt on the Upcoming card. The inbox keeps working
throughout.

Clicking that prompt runs the normal connect flow. `/api/google/connect`
sends `prompt: "consent"`, so Google re-shows the permission screen
rather than silently reissuing the old grant, and the new token comes
back covering both scopes.

The same applies to any scope added later: append it to `GOOGLE_SCOPES`,
add it to the consent screen in step 2c, and existing users reconnect
once.
