-- Two-way messaging between a coach and one athlete.
--
-- Until now an athlete could leave a day note, a feedback blob or a form-check
-- clip, but could not ask a question: coach messages rode the coach-owned
-- `athletes.session_bank` jsonb, which only the coach can write. A thread needs
-- both sides able to append, so it gets its own table.
--
-- One row per message. `athlete_id` names the thread (there is a single coach),
-- and `sender` says which end it came from. `read_at` is stamped by the OTHER
-- side, which is what drives unread badges.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  athlete_id text not null references public.athletes(id) on delete cascade,
  sender     text not null check (sender in ('coach', 'athlete')),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  -- When the recipient read it. Null = unread.
  read_at    timestamptz
);

-- Threads are always read newest-first for one athlete.
create index if not exists messages_athlete_created_idx
  on public.messages (athlete_id, created_at desc);
-- The coach's unread badge scans only unread athlete-sent rows.
create index if not exists messages_unread_idx
  on public.messages (athlete_id) where read_at is null;

alter table public.messages enable row level security;

-- ---------- who may do what ----------
-- Both sides may read the whole thread and append their own end of it. Neither
-- may rewrite history: the only column an update is allowed to touch is
-- read_at, enforced by the trigger below rather than by policy, since a policy
-- can't compare old and new rows.

create policy "athlete reads own thread" on public.messages
  for select to authenticated
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

create policy "athlete writes own messages" on public.messages
  for insert to authenticated
  with check (
    sender = 'athlete'
    and athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
  );

create policy "athlete marks coach messages read" on public.messages
  for update to authenticated
  using (
    sender = 'coach'
    and athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
  )
  with check (
    sender = 'coach'
    and athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
  );

create policy "coach reads own athletes threads" on public.messages
  for select to authenticated
  using (athlete_id in (
    select a.id from public.athletes a
    join public.coaches c on c.id = a.coach_id
    where c.auth_user_id = (select auth.uid())
  ));

create policy "coach writes to own athletes" on public.messages
  for insert to authenticated
  with check (
    sender = 'coach'
    and athlete_id in (
      select a.id from public.athletes a
      join public.coaches c on c.id = a.coach_id
      where c.auth_user_id = (select auth.uid())
    )
  );

create policy "coach marks athlete messages read" on public.messages
  for update to authenticated
  using (
    sender = 'athlete'
    and athlete_id in (
      select a.id from public.athletes a
      join public.coaches c on c.id = a.coach_id
      where c.auth_user_id = (select auth.uid())
    )
  )
  with check (
    sender = 'athlete'
    and athlete_id in (
      select a.id from public.athletes a
      join public.coaches c on c.id = a.coach_id
      where c.auth_user_id = (select auth.uid())
    )
  );

-- ---------- history is append-only ----------
-- The update policies exist so each side can mark the other's messages read.
-- Nothing else about a message may change, or "mark as read" would double as
-- "edit what they said".
create or replace function public.messages_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id         is distinct from old.id
  or new.athlete_id is distinct from old.athlete_id
  or new.sender     is distinct from old.sender
  or new.body       is distinct from old.body
  or new.created_at is distinct from old.created_at then
    raise exception 'messages: only read_at may be updated';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard on public.messages;
create trigger messages_guard
  before update on public.messages
  for each row execute function public.messages_guard_update();
