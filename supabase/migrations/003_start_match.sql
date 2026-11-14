-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 003 - Authoritative Match Start & Private Role Reveal RPCs
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
  v_players record;
  v_player_ids uuid[];
  v_player_count integer;
  v_imposter_count integer := 1;
  v_category text;
  v_imposters uuid[];
  v_regular_ids uuid[];
  v_secret record;
  v_round_id uuid;
  v_round_number integer;
  v_clue_order uuid[];
  v_imposter_info text;
  v_allow_imposter_first boolean := true;
  v_shuffled_players uuid[];
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

  -- 1. Idempotency check: prevent duplicate submissions
  if exists (
    select 1 from public.action_log
    where room_id = p_room_id and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- 2. Validate room & host authority
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

  -- 3. Gather active players
  select array_agg(id order by joined_at asc) into v_player_ids
  from public.players
  where room_id = p_room_id and removed_at is null and connection <> 'disconnected';

  v_player_count := coalesce(array_length(v_player_ids, 1), 0);
  if v_player_count < 2 then
    raise exception 'Need at least 2 active players to start';
  end if;

  -- 4. Determine Imposter count & game mode rules
  if v_player_count = 2 then
    -- Double Agent Mode: 50% chance of 0 imposters, 50% chance of 1 imposter
    if random() < 0.5 then
      v_imposter_count := 0;
    else
      v_imposter_count := 1;
    end if;
  elsif v_player_count = 3 then
    v_imposter_count := 1;
  elsif v_player_count between 4 and 5 then
    v_imposter_count := 1;
  elsif v_player_count between 6 and 8 then
    v_imposter_count := 1;
  else
    v_imposter_count := 2;
  end if;

  -- The imposter always receives the selected category as a clue.
  v_imposter_info := 'category_hint';
  v_category := coalesce(nullif(v_room.settings->>'category', ''), 'any');

  if v_room.settings ? 'allowImposterFirst' then
    v_allow_imposter_first := (v_room.settings->>'allowImposterFirst')::boolean;
  end if;

  -- 5. Randomly assign Imposter(s)
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

  -- 6. Pick secret word from word bank
  select * into v_secret
  from public.word_bank
  where v_category = 'any' or category = v_category
  order by random()
  limit 1;

  if not found then
    if v_category <> 'any' then
      raise exception 'No words available for category %', v_category;
    end if;
    -- Fallback safety word if bank was empty
    v_secret.word := 'Compass';
    v_secret.category := 'Objects';
  end if;

  -- 7. Determine Clue Order with weighted first speaker (1.0 regular vs 0.35 imposter)
  -- If imposter-first is disabled or 0 imposters, pick regular first
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
    -- Weighted draw: regular weight 1.0, imposter weight 0.35
    select pid into v_first_player
    from (
      select u.pid,
        case when u.pid = any(v_imposters) then 0.35 else 1.0 end * random() as weighted_score
      from unnest(v_player_ids) as u(pid)
      order by weighted_score desc
      limit 1
    ) s;
  end if;

  -- Shuffle remainder uniformly
  select array_agg(pid) into v_rest_players
  from (
    select u.pid
    from unnest(v_player_ids) as u(pid)
    where u.pid <> v_first_player
    order by random()
  ) s;

  v_clue_order := array_prepend(v_first_player, coalesce(v_rest_players, '{}'));
  v_round_number := v_room.round_number + 1;

  -- 8. Create Round
  insert into public.rounds (
    room_id, round_number, clue_order, current_turn_index
  )
  values (
    p_room_id, v_round_number, v_clue_order, 0
  )
  returning id into v_round_id;

  -- 9. Insert Round Secrets (locked to everyone)
  insert into public.round_secrets (
    round_id, secret_word, category, imposter_info
  )
  values (
    v_round_id, v_secret.word, v_secret.category, v_imposter_info
  );

  -- 10. Insert Private Roles (each player can only query their own row)
  foreach v_pid in array v_player_ids loop
    v_is_imp := (v_pid = any(v_imposters));

    if v_is_imp then
      v_role := 'imposter';
      v_word := null; -- Guaranteed NULL
      if v_imposter_info = 'category_hint' then
        v_cat := v_secret.category;
      else
        v_cat := null;
      end if;
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

  -- 11. Advance Room Phase to private_role_reveal
  update public.rooms
  set
    phase = 'private_role_reveal',
    current_round_id = v_round_id,
    round_number = v_round_number,
    version = version + 1,
    last_activity_at = now()
  where id = p_room_id;

  -- Log action idempotently
  insert into public.action_log (room_id, player_id, action, idempotency_key)
  values (p_room_id, v_room.host_player_id, 'start_match', p_idempotency_key);

  return jsonb_build_object(
    'ok', true,
    'roundId', v_round_id,
    'roundNumber', v_round_number
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- ACKNOWLEDGE ROLE & PROCEED TO CLUE TURNS
-- ----------------------------------------------------------------------------
create or replace function public.acknowledge_role(
  p_round_id uuid,
  p_player_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_round record;
  v_room record;
  v_unacknowledged_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Verify player identity
  if not exists (
    select 1 from public.players
    where id = p_player_id and user_id = v_user_id
  ) then
    raise exception 'Player not owned by caller';
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  select * into v_room from public.rooms where id = v_round.room_id;

  -- Mark player as acknowledged
  update public.round_roles
  set acknowledged_at = now()
  where round_id = p_round_id and player_id = p_player_id;

  -- Check if all active players in room have acknowledged
  select count(*) into v_unacknowledged_count
  from public.round_roles rr
  join public.players p on p.id = rr.player_id
  where rr.round_id = p_round_id
    and rr.acknowledged_at is null
    and p.connection <> 'disconnected';

  -- If all acknowledged and still in reveal phase, transition to clue_turn
  if v_unacknowledged_count = 0 and v_room.phase = 'private_role_reveal' then
    update public.rooms
    set
      phase = 'clue_turn',
      version = version + 1,
      last_activity_at = now()
    where id = v_room.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'allAcknowledged', v_unacknowledged_count = 0
  );
end;
$$;

grant execute on function public.start_match(uuid, text) to authenticated;
grant execute on function public.acknowledge_role(uuid, uuid) to authenticated;
