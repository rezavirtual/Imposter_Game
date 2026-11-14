-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 006 - Category Selection, Imposter Hint and Vote Majority Fixes
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

create or replace function public.cast_vote(
  p_round_id uuid,
  p_voter_id uuid,
  p_target_id uuid,
  p_is_no_imposter boolean default false,
  p_idempotency_key text default ''
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
  v_voter record;
  v_is_revote boolean;
  v_total_eligible integer;
  v_total_locked integer;
  v_max_votes integer;
  v_leader_count integer;
  v_tied_ids uuid[];
  v_winner_id uuid;
  v_eliminated_is_imposter boolean := false;
  v_secret record;
  v_imp_ids uuid[];
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_voter from public.players where id = p_voter_id and user_id = v_user_id;
  if not found then
    raise exception 'Voter not owned by caller';
  end if;

  select * into v_round from public.rounds where id = p_round_id;
  select * into v_room from public.rooms where id = v_round.room_id and closed_at is null;

  if v_room.phase not in ('voting', 'tied_revote') then
    raise exception 'Room is not in voting phase (currently %)', v_room.phase;
  end if;

  v_is_revote := (v_room.phase = 'tied_revote');

  if p_target_id = p_voter_id then
    raise exception 'You cannot vote for yourself';
  end if;

  if v_is_revote and v_round.revote_candidates is not null then
    if not (p_target_id = any(v_round.revote_candidates)) then
      raise exception 'Target is not an eligible candidate in this revote';
    end if;
  end if;

  insert into public.votes (round_id, voter_id, is_revote, target_player_id, is_no_imposter)
  values (p_round_id, p_voter_id, v_is_revote, p_target_id, p_is_no_imposter)
  on conflict (round_id, voter_id, is_revote)
  do update set
    target_player_id = excluded.target_player_id,
    is_no_imposter = excluded.is_no_imposter,
    locked_at = now();

  select count(*)::int into v_total_eligible
  from public.players
  where room_id = v_room.id and connection <> 'disconnected' and not is_eliminated;

  select count(*)::int into v_total_locked
  from public.votes
  where round_id = p_round_id and is_revote = v_is_revote;

  if v_total_locked < v_total_eligible then
    return jsonb_build_object(
      'ok', true,
      'allLocked', false,
      'lockedCount', v_total_locked,
      'eligibleCount', v_total_eligible
    );
  end if;

  select coalesce(max(vote_count), 0)::int into v_max_votes
  from (
    select count(*)::int as vote_count
    from public.votes
    where round_id = p_round_id and is_revote = v_is_revote
    group by target_player_id, is_no_imposter
  ) c;

  select count(*)::int into v_leader_count
  from (
    select count(*)::int as vote_count
    from public.votes
    where round_id = p_round_id and is_revote = v_is_revote
    group by target_player_id, is_no_imposter
  ) c
  where vote_count = v_max_votes;

  if v_leader_count > 1 then
    select array_agg(target_player_id) into v_tied_ids
    from (
      select target_player_id, count(*)::int as vote_count
      from public.votes
      where round_id = p_round_id and is_revote = v_is_revote
      group by target_player_id, is_no_imposter
    ) c2
    where c2.vote_count = v_max_votes;
  else
    select target_player_id into v_winner_id
    from (
      select target_player_id, count(*)::int as vote_count
      from public.votes
      where round_id = p_round_id and is_revote = v_is_revote
      group by target_player_id, is_no_imposter
    ) c3
    where c3.vote_count = v_max_votes;
  end if;

  if coalesce(v_leader_count, 0) > 1 then
    if not v_is_revote then
      update public.rounds
      set is_revote = true, revote_candidates = v_tied_ids
      where id = p_round_id;

      update public.rooms
      set phase = 'tied_revote', version = version + 1, last_activity_at = now()
      where id = v_room.id;

      return jsonb_build_object('ok', true, 'tied', true, 'revote', true);
    else
      v_winner_id := null;
    end if;
  end if;

  select * into v_secret from public.round_secrets where round_id = p_round_id;

  select array_agg(player_id) into v_imp_ids
  from public.round_roles
  where round_id = p_round_id and role = 'imposter';

  if v_winner_id is not null then
    v_eliminated_is_imposter := (v_winner_id = any(v_imp_ids));
    update public.players set is_eliminated = true where id = v_winner_id;
  end if;

  update public.rounds
  set eliminated_player_id = v_winner_id
  where id = p_round_id;

  if v_eliminated_is_imposter then
    update public.rooms
    set phase = 'imposter_final_guess', version = version + 1, last_activity_at = now()
    where id = v_room.id;
  else
    perform public.finalize_round_scoring(p_round_id, null);

    update public.rooms
    set phase = 'round_result', version = version + 1, last_activity_at = now()
    where id = v_room.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'allLocked', true,
    'eliminatedPlayerId', v_winner_id,
    'eliminatedIsImposter', v_eliminated_is_imposter
  );
end;
$$;

grant execute on function public.start_match(uuid, text) to authenticated;
grant execute on function public.cast_vote(uuid, uuid, uuid, boolean, text) to authenticated;
