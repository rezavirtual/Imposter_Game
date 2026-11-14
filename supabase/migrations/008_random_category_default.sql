-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 008 - Default to a random category
-- ============================================================================

create or replace function public.start_match(
  p_room_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room record;
  v_host_player record;
  v_player_ids uuid[];
  v_player_count integer;
  v_imposter_count integer := 1;
  v_imposters uuid[];
  v_secret record;
  v_round_id uuid;
  v_round_number integer;
  v_clue_order uuid[];
  v_imposter_info text := 'category_hint';
  v_category text;
  v_allow_imposter_first boolean := true;
  v_first_player uuid;
  v_rest_players uuid[];
  v_pid uuid;
  v_is_imp boolean;
  v_role text;
  v_word text;
  v_cat text;
  v_instr text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if exists (
    select 1 from public.action_log
    where room_id = p_room_id and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into v_room from public.rooms where id = p_room_id and closed_at is null;
  if not found then
    raise exception 'Room not found or closed';
  end if;

  select * into v_host_player from public.players where id = v_room.host_player_id;
  if v_host_player.user_id <> v_user_id then
    raise exception 'Only the room host can start the match';
  end if;

  if v_room.phase not in ('lobby', 'scoreboard', 'next_round') then
    raise exception 'Match cannot be started from phase %', v_room.phase;
  end if;

  select array_agg(id order by joined_at asc) into v_player_ids
  from public.players
  where room_id = p_room_id and removed_at is null and connection <> 'disconnected';

  v_player_count := coalesce(array_length(v_player_ids, 1), 0);
  if v_player_count < 2 then
    raise exception 'Need at least 2 active players to start';
  end if;

  if v_player_count = 2 then
    if random() < 0.5 then
      v_imposter_count := 0;
    else
      v_imposter_count := 1;
    end if;
  elsif v_player_count between 4 and 8 then
    v_imposter_count := 1;
  elsif v_player_count = 3 then
    v_imposter_count := 1;
  else
    v_imposter_count := 2;
  end if;

  v_category := coalesce(nullif(v_room.settings->>'category', ''), 'random');
  if v_category = 'random' then
    select available.category into v_category
    from (select distinct category from public.word_bank) as available
    order by random()
    limit 1;

    if v_category is null then
      v_category := 'any';
    end if;
  end if;

  if v_room.settings ? 'allowImposterFirst' then
    v_allow_imposter_first := (v_room.settings->>'allowImposterFirst')::boolean;
  end if;

  v_imposters := '{}';
  if v_imposter_count > 0 then
    select array_agg(pid) into v_imposters
    from (
      select u.pid
      from unnest(v_player_ids) as u(pid)
      order by random()
      limit v_imposter_count
    ) s;
  end if;

  select * into v_secret
  from public.word_bank
  where v_category = 'any' or category = v_category
  order by random()
  limit 1;

  if not found then
    if v_category <> 'any' then
      raise exception 'No words available for category %', v_category;
    end if;
    v_secret.word := 'Compass';
    v_secret.category := 'Objects';
  end if;

  if not v_allow_imposter_first or v_imposter_count = 0 then
    select pid into v_first_player
    from (
      select u.pid
      from unnest(v_player_ids) as u(pid)
      where not (u.pid = any(v_imposters))
      order by random()
      limit 1
    ) s;
  else
    select pid into v_first_player
    from (
      select u.pid,
        case when u.pid = any(v_imposters) then 0.35 else 1.0 end * random() as weighted_score
      from unnest(v_player_ids) as u(pid)
      order by weighted_score desc
      limit 1
    ) s;
  end if;

  select array_agg(pid) into v_rest_players
  from (
    select u.pid
    from unnest(v_player_ids) as u(pid)
    where u.pid <> v_first_player
    order by random()
  ) s;

  v_clue_order := array_prepend(v_first_player, coalesce(v_rest_players, '{}'));
  v_round_number := v_room.round_number + 1;

  insert into public.rounds (
    room_id, round_number, clue_order, current_turn_index
  )
  values (
    p_room_id, v_round_number, v_clue_order, 0
  )
  returning id into v_round_id;

  insert into public.round_secrets (
    round_id, secret_word, category, imposter_info
  )
  values (
    v_round_id, v_secret.word, v_secret.category, v_imposter_info
  );

  foreach v_pid in array v_player_ids loop
    v_is_imp := (v_pid = any(v_imposters));

    if v_is_imp then
      v_role := 'imposter';
      v_word := null;
      v_cat := v_secret.category;
      v_instr := 'You are the IMPOSTER. Listen to clues, blend in, and guess the secret word.';
    else
      v_role := 'regular';
      v_word := v_secret.word;
      v_cat := v_secret.category;
      v_instr := 'You are a REGULAR player. Give a subtle clue without saying the secret word.';
    end if;

    insert into public.round_roles (
      round_id, player_id, role, secret_word, category, instruction
    )
    values (
      v_round_id, v_pid, v_role, v_word, v_cat, v_instr
    );
  end loop;

  update public.rooms
  set
    phase = 'private_role_reveal',
    current_round_id = v_round_id,
    round_number = v_round_number,
    version = version + 1,
    last_activity_at = now()
  where id = p_room_id;

  insert into public.action_log (room_id, player_id, action, idempotency_key)
  values (p_room_id, v_room.host_player_id, 'start_match', p_idempotency_key);

  return jsonb_build_object(
    'ok', true,
    'roundId', v_round_id,
    'roundNumber', v_round_number
  );
end;
$$;
