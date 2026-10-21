-- Nexus — launch hardening
--
-- Run this once, in the Supabase SQL editor
-- (your project → SQL Editor → New query → paste → Run).
-- Safe to run twice: every statement is idempotent.

-- 1. Row-level security on the two tables SETUP.md creates without it.
--
--    Every other table here has RLS on with no policies, so only the
--    service role (the server) can reach it. SETUP.md's statements for
--    brief_cache and brief_deliveries didn't enable it. (Newer Supabase
--    projects turn it on by default, so it may already be on — this
--    makes sure.) A `public` table without RLS is readable and writable
--    through the project's anon key, and brief_cache holds summaries of
--    people's email.
alter table if exists public.brief_cache enable row level security;
alter table if exists public.brief_deliveries enable row level security;

-- 2. Per-user rate limits for the routes that cost money per call
--    (model calls, text-to-speech). One row per user, bucket and window.
create table if not exists public.rate_limits (
  user_id      text not null,
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;

-- Counts one hit and says whether it was within the limit. Done in one
-- statement so two concurrent requests can't both read "under" and both
-- go through. Old windows are cleared opportunistically.
create or replace function public.nexus_rate_limit_hit(
  p_user_id text,
  p_bucket text,
  p_window_seconds integer,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
  do update set hits = r.hits + 1
  returning hits into v_hits;

  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.nexus_rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.nexus_rate_limit_hit(text, text, integer, integer) to service_role;
