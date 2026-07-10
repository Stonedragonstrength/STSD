-- Open Slots: coaches broadcast appointment openings; athletes claim first-come.
--
-- Stored as a jsonb array on the coach row (no new table). Each slot:
--   { id, label, note, status: 'open'|'claimed'|'closed',
--     claimedBy, claimedByName, claimedAt, createdAt }
--
-- Athletes can't read the coaches table (RLS), so reads/claims go through the
-- SECURITY DEFINER RPCs below — same pattern as the invite-code functions.

alter table public.coaches
  add column if not exists open_slots jsonb not null default '[]'::jsonb;

-- Returns just the calling athlete's coach's open_slots. Auth required.
create or replace function public.open_slots_for_athlete()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(c.open_slots, '[]'::jsonb)
  from public.coaches c
  join public.athletes a on a.coach_id = c.id
  where a.auth_user_id = (select auth.uid())
  limit 1;
$$;

-- Atomic first-come claim: marks a slot 'claimed' only if it's still 'open'.
-- Row-locks the coach record so two simultaneous claims can't both win.
create or replace function public.claim_open_slot(slot_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_athlete   public.athletes;
  v_slots     jsonb;
  v_idx       int := null;
  v_slot      jsonb;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select * into v_athlete from public.athletes
    where auth_user_id = (select auth.uid()) limit 1;
  if v_athlete.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_athlete');
  end if;

  -- Lock the coach row so the read-modify-write is atomic.
  select open_slots into v_slots from public.coaches
    where id = v_athlete.coach_id for update;
  if v_slots is null then
    return jsonb_build_object('ok', false, 'reason', 'no_coach');
  end if;

  for i in 0 .. coalesce(jsonb_array_length(v_slots), 0) - 1 loop
    if v_slots -> i ->> 'id' = slot_id then
      v_idx := i;
      v_slot := v_slots -> i;
      exit;
    end if;
  end loop;

  if v_idx is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if coalesce(v_slot ->> 'status', 'open') <> 'open' then
    return jsonb_build_object('ok', false, 'reason', 'taken',
      'claimedByName', v_slot ->> 'claimedByName');
  end if;

  v_slot := v_slot || jsonb_build_object(
    'status', 'claimed',
    'claimedBy', v_athlete.id,
    'claimedByName', coalesce(v_athlete.display_name, ''),
    'claimedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  update public.coaches
    set open_slots = jsonb_set(v_slots, array[v_idx::text], v_slot)
    where id = v_athlete.coach_id;

  return jsonb_build_object('ok', true, 'slot', v_slot);
end;
$$;

grant execute on function public.open_slots_for_athlete() to authenticated;
grant execute on function public.claim_open_slot(text) to authenticated;
