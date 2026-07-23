-- Coach-authored edits to the Anatomy / Science page. The coach can rewrite the
-- built-in muscle and concept content and add their own cards; athletes see the
-- coach's curated version. Stored as one jsonb blob on the coach row (no new
-- table), synced to athletes through a SECURITY DEFINER RPC, same as open_slots.
--
-- Shape (all keys optional):
--   { concepts:    { "<cardId>":   { term?, short?, def?, take?, hidden? } },
--     conceptAdds: { "<sectionId>": [ { id, term, short, def, take } ] },
--     muscles:     { "<muscleId>": { does?, why?, warmup?, pairs?, frequency?,
--                                     cues?, mistakes?, stretches?, injuries?,
--                                     anchors?, accessories?, note? } } }

alter table public.coaches
  add column if not exists anatomy_edits jsonb not null default '{}'::jsonb;

-- Returns just the calling athlete's coach's anatomy_edits. Auth required.
create or replace function public.anatomy_edits_for_athlete()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(c.anatomy_edits, '{}'::jsonb)
  from public.coaches c
  join public.athletes a on a.coach_id = c.id
  where a.auth_user_id = (select auth.uid())
  limit 1;
$$;

grant execute on function public.anatomy_edits_for_athlete() to authenticated;
