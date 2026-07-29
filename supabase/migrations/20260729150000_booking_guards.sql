-- Guards the athlete side of a booking insert.
--
-- The insert policy proves the athlete owns `athlete_id`, but every other
-- column arrives from the browser and is therefore a claim, not a fact. Two
-- things follow from that: the coach the booking is filed under must be
-- derived rather than accepted, and the length must be bounded, or an athlete
-- could book a coach they aren't with, or hold an eight-hour slot.

-- Sanity bound on the appointment itself. 15 minutes to 4 hours covers every
-- real session and nothing else.
alter table public.bookings
  drop constraint if exists bookings_sane_window;
alter table public.bookings
  add constraint bookings_sane_window check (
    end_at > start_at
    and end_at <= start_at + interval '4 hours'
    and end_at >= start_at + interval '15 minutes'
  );

-- coach_id is derived from the athlete row, never taken from the request.
create or replace function public.bookings_set_coach()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  real_coach text;
begin
  select a.coach_id into real_coach from public.athletes a where a.id = new.athlete_id;
  if real_coach is null then
    raise exception 'bookings: athlete has no coach';
  end if;
  new.coach_id := real_coach;
  return new;
end;
$$;

drop trigger if exists bookings_coach on public.bookings;
create trigger bookings_coach
  before insert on public.bookings
  for each row execute function public.bookings_set_coach();
