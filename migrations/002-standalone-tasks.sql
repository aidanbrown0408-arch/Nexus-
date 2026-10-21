-- Nexus — reminders that don't hang off a meeting
--
-- Run this once, in the Supabase SQL editor
-- (your project → SQL Editor → New query → paste → Run).
-- Safe to run twice: every statement is idempotent.
--
-- `prep_items` started life as "things to do before this event", so every
-- row was required to name one. That made the Reminders list unable to
-- hold the most ordinary kind of reminder there is — "call the dentist
-- Friday" — which is the one thing a to-do list has to be able to do.
--
-- The table keeps its name and its event rows. What changes is that an
-- event is now optional, and an item can carry a date of its own.

-- 1. An item no longer has to belong to an event.
alter table public.prep_items
  alter column event_key drop not null;

-- 2. Its own due date. Null on an event-linked item means "whenever the
--    event is" — the list reads `due_at` first and falls back to
--    `event_start`, so old rows need no backfill and keep sorting exactly
--    where they did.
alter table public.prep_items
  add column if not exists due_at timestamptz;

-- 3. Where the item came from. Not cosmetic: it's what lets the list say
--    "from email: Dana" on a row whose title is just a subject line, and
--    what tells an undo which rows Nexus itself created.
alter table public.prep_items
  add column if not exists source text not null default 'event';

-- Added separately from the column so re-running this doesn't fail on a
-- constraint that already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'prep_items_source_check'
  ) then
    alter table public.prep_items
      add constraint prep_items_source_check
      check (source in ('event', 'manual', 'chat', 'email'));
  end if;
end $$;

-- 4. Whatever the source needs to point back at itself — a Gmail message
--    and thread id, for now. Shapeless on purpose, like action_log.target:
--    a new source shouldn't need another migration.
alter table public.prep_items
  add column if not exists source_ref jsonb;

-- The existing index is (user_id, event_key), which a dateless standalone
-- task can't use. The list reads by date.
create index if not exists prep_items_user_due_idx
  on public.prep_items (user_id, due_at);

-- 5. The action log learns about tasks Nexus created itself, so one made
--    from chat can be undone like any other action.
alter table public.action_log
  drop constraint if exists action_log_kind_check;
alter table public.action_log
  add constraint action_log_kind_check
  check (kind in ('draft_reply', 'archive', 'label', 'filter', 'trash',
                  'event_create', 'event_delete', 'task_create'));

alter table public.action_log
  drop constraint if exists action_log_undo_check;
alter table public.action_log
  add constraint action_log_undo_check
  check (undo in ('delete_draft', 'unarchive', 'remove_label',
                  'remove_filter', 'untrash', 'delete_event',
                  'restore_event', 'delete_task', 'none'));
