-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 004 - Clue Turn Advancement, Host Override & Voting Triggers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. GIVE CLUE (Active Player Only)
-- ----------------------------------------------------------------------------
create or replace function public.give_clue(
  p_round_id uuid,
  p_player_id uuid,
  p_expected_index integer,
  p_idempotency_key text
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
  v_active_player_id uuid;
  v_order_len integer;
  v_next_index integer;
  v_is_last boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  -- Verify caller owns this player seat
  if not exists (
    select 1 from public.players
    where id = p_player_id and user_id = v_user_id
  ) then
    raise exception 'Unauthorized caller';
  end if;

  -- Idempotency check: prevent double taps from skipping players
  if exists (
    select 1 from public.action_log
    where room_id = (select room_id from public.rounds where id = p_round_id)
      and idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  if not found then
    raise exception 'Round not found';
  end if;

  select * into v_room from public.rooms where id = v_round.room_id and closed_at is null;
  if v_room.phase <> 'clue_turn' then
    raise exception 'Room is not in clue_turn phase (currently %)', v_room.phase;
  end if;

  v_order_len := array_length(v_round.clue_order, 1);
  if v_round.current_turn_index >= v_order_len then
    raise exception 'All clues have already been given';
  end if;

  if v_round.current_turn_index <> p_expected_index then
    raise exception 'Stale turn index (expected %, current %)', p_expected_index, v_round.current_turn_index;
  end if;

  -- Verify caller is the active player
  v_active_player_id := v_round.clue_order[v_round.current_turn_index + 1];
  if v_active_player_id <> p_player_id then
    raise exception 'Not your turn to give a clue';
  end if;

  v_next_index := v_round.current_turn_index + 1;
  v_is_last := (v_next_index >= v_order_len);

  -- Update round turn index
  update public.rounds
  set current_turn_index = v_next_index
  where id = p_round_id;

  -- If last clue was given, transition automatically to discussion
  if v_is_last then
    update public.rooms
    set
      phase = 'discussion',
      version = version + 1,
      last_activity_at = now()
    where id = v_room.id;
  else
    update public.rooms
    set
      version = version + 1,
      last_activity_at = now()
    where id = v_room.id;
  end if;

  -- Record idempotency
  insert into public.action_log (room_id, player_id, action, idempotency_key)
  values (v_room.id, p_player_id, 'give_clue', p_idempotency_key);

  return jsonb_build_object(
    'ok', true,
    'nextIndex', v_next_index,
    'isComplete', v_is_last
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. ADVANCE TURN BY HOST (Host Override for stuck/unresponsive players)
-- ----------------------------------------------------------------------------
create or replace function public.advance_turn_by_host(
  p_round_id uuid,
  p_expected_index integer,
  p_idempotency_key text
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
  v_host_player record;
  v_order_len integer;
  v_next_index integer;
  v_is_last boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  select * into v_room from public.rooms where id = v_round.room_id and closed_at is null;

  -- Verify host authority
  select * into v_host_player from public.players where id = v_room.host_player_id;
  if v_host_player.user_id <> v_user_id then
    raise exception 'Only the host can advance stuck turns';
  end if;

  if v_room.phase <> 'clue_turn' then
    raise exception 'Room is not in clue_turn phase';
  end if;

  if v_round.current_turn_index <> p_expected_index then
    raise exception 'Stale turn index';
  end if;

  v_order_len := array_length(v_round.clue_order, 1);
  v_next_index := v_round.current_turn_index + 1;
  v_is_last := (v_next_index >= v_order_len);

  update public.rounds
  set current_turn_index = v_next_index
  where id = p_round_id;

  if v_is_last then
    update public.rooms
    set
      phase = 'discussion',
      version = version + 1,
      last_activity_at = now()
    where id = v_room.id;
  else
    update public.rooms
    set
      version = version + 1,
      last_activity_at = now()
    where id = v_room.id;
  end if;

  insert into public.action_log (room_id, player_id, action, idempotency_key)
  values (v_room.id, v_host_player.id, 'advance_turn_by_host', p_idempotency_key);

  return jsonb_build_object(
    'ok', true,
    'nextIndex', v_next_index,
    'isComplete', v_is_last
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. START VOTING (Host action from discussion)
-- ----------------------------------------------------------------------------
create or replace function public.start_voting(
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
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_room from public.rooms where id = p_room_id and closed_at is null;
  select * into v_host_player from public.players where id = v_room.host_player_id;

  if v_host_player.user_id <> v_user_id then
    raise exception 'Only the host can start voting';
  end if;

  if v_room.phase <> 'discussion' then
    raise exception 'Voting can only be started from discussion phase';
  end if;

  update public.rooms
  set
    phase = 'voting',
    version = version + 1,
    last_activity_at = now()
  where id = p_room_id;

  insert into public.action_log (room_id, player_id, action, idempotency_key)
  values (p_room_id, v_host_player.id, 'start_voting', p_idempotency_key);

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.give_clue(uuid, uuid, integer, text) to authenticated;
grant execute on function public.advance_turn_by_host(uuid, integer, text) to authenticated;
grant execute on function public.start_voting(uuid, text) to authenticated;
