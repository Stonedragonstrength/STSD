-- Booking cutoff for open slots: an athlete can't claim within `cutoffHours`
-- of the slot's start time. Enforced server-side (the app also hides the
-- button, but this is the authoritative gate).
--
-- Slots gain: startAt (ISO/UTC timestamp) + cutoffHours (int; 0 = no cutoff).

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
  v_start     text;
  v_cutoff    int;
begin
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select * into v_athlete from public.athletes
    where auth_user_id = (select auth.uid()) limit 1;
  if v_athlete.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_athlete');
  end if;

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

  -- Booking cutoff: no claims within cutoffHours of the start time.
  v_start  := nullif(v_slot ->> 'startAt', '');
  v_cutoff := coalesce((v_slot ->> 'cutoffHours')::int, 0);
  if v_start is not null and v_cutoff > 0
     and now() >= v_start::timestamptz - make_interval(hours => v_cutoff) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
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
