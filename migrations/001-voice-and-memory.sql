-- Nexus — voice replies + the memory layer
--
-- Run this once, in the Supabase SQL editor
-- (your project → SQL Editor → New query → paste → Run).
-- Safe to run twice: every statement is idempotent.

-- 1. Voice: whether chat replies should be read aloud.
--    Null reads as muted, which is the default anyway, so there is
--    nothing to backfill.
alter table public.user_profile
  add column if not exists voice_replies boolean;

-- 2. Memory: short facts Nexus infers while writing the morning brief,
--    read back into every later brief and chat answer.
create table if not exists public.user_facts (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null,
  category     text not null check (category in
                 ('person', 'deadline', 'project', 'preference')),
  fact         text not null,
  -- The message id or event key this was read out of. Not null on
  -- purpose: a fact with no source cannot be checked, and an
  -- unfalsifiable claim in a prompt is what this table exists to avoid.
  source_id    text not null,
  source_label text,
  source_kind  text,
  -- Null means "no reason to think this stops being true" (who someone
  -- is). A date means it rots — every deadline gets one, whether or not
  -- the model supplied it.
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists user_facts_user_created_idx
  on public.user_facts (user_id, created_at desc);

-- Every table in this app is reached through the service role key with
-- Clerk as the authority on identity, so RLS is on and no policy is
-- granted: nothing but the server can read this.
alter table public.user_facts enable row level security;
