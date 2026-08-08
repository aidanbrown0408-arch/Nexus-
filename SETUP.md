# Gmail integration setup

Follow these steps once before running the app. Both Supabase and Google
Cloud Console need a bit of configuration.

## 1. Supabase

### 1a. Create the tokens table

Open your Supabase project → **SQL Editor** → **New query**, paste the
following, and run it:

```sql
create table if not exists public.gmail_tokens (
  user_id       text primary key,
  access_token  text not null,
  refresh_token text,
  token_expiry  timestamptz,
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.gmail_tokens enable row level security;

-- We authenticate with Clerk, not Supabase Auth, and only ever touch this
-- table from server routes using the service role key. RLS is enabled so
-- that anon/authenticated roles can't read tokens even by mistake — the
-- service role key bypasses RLS on purpose.
```

`user_id` stores the Clerk user id (e.g. `user_2abc...`).

### 1b. Grab the environment variables

In Supabase → **Project Settings** → **API**, copy:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **`service_role` secret** → `SUPABASE_SERVICE_ROLE_KEY`
  (Server-only. Never expose it to the browser.)

## 2. Google Cloud Console

### 2a. Create / pick a project

Go to <https://console.cloud.google.com/> and either select an existing
project or create a new one (top-left project dropdown → **New project**).

### 2b. Enable the Gmail API

- Navigation menu → **APIs & Services** → **Library**
- Search for **Gmail API**, open it, click **Enable**.

### 2c. Configure the OAuth consent screen

- **APIs & Services** → **OAuth consent screen**
- User type: **External** (unless you're on a Workspace org that wants
  Internal).
- App name: `Nexus` (anything you like), user support email, developer
  contact email. Save & continue.
- **Scopes**: click **Add or remove scopes** and add:
  - `https://www.googleapis.com/auth/gmail.readonly`
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
  - `http://localhost:3000/api/gmail/callback`
  - (add the production equivalent later, e.g.
    `https://your-domain.com/api/gmail/callback`)
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
GOOGLE_REDIRECT_URI=http://localhost:3000/api/gmail/callback

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Restart the dev server after editing `.env.local`.

## 4. Try it

1. `npm run dev`
2. Sign in, visit `/dashboard`.
3. Click **Connect Gmail** — you'll be sent to Google, grant permission,
   and land back on the dashboard.
4. Your 20 most recent emails should appear. Use **Refresh** to re-fetch.

If Google returns `access_denied`, the app will show a friendly banner
instead of crashing. Same for any Gmail API failure at fetch time.
