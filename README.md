# Nexus

An AI personal assistant. This is the foundation step: Next.js + Tailwind CSS
+ Clerk authentication, a public landing page, and a protected dashboard.
Gmail, Google Calendar, and Claude integration come in later steps.

## Local setup

1. Copy `.env.local.example` to `.env.local` and fill in your Clerk keys
   (from https://dashboard.clerk.com).
2. `npm install`
3. `npm run dev`
4. Open http://localhost:3000

## Project structure

- `app/layout.tsx` — root layout, wraps the app in `ClerkProvider`
- `app/page.tsx` — public landing page
- `app/sign-in/`, `app/sign-up/` — Clerk's hosted auth pages
- `app/dashboard/page.tsx` — protected page, shows the signed-in user
- `middleware.ts` — redirects signed-out users away from `/dashboard`
