-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 005 (Fixed) - Robust Voting Resolution
-- ============================================================================

alter table public.round_secrets no force row level security;
alter table public.round_roles   no force row level security;
alter table public.votes         no force row level security;

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

  -- Self-vote check
  if p_target_id = p_voter_id then
    raise exception 'You cannot vote for yourself';
  end if;

  -- Revote candidate restriction check
  if v_is_revote and v_round.revote_candidates is not null then
    if not (p_target_id = any(v_round.revote_candidates)) then
      raise exception 'Target is not an eligible candidate in this revote';
    end if;
  end if;

  -- Record vote
  insert into public.votes (round_id, voter_id, is_revote, target_player_id, is_no_imposter)
  values (p_round_id, p_voter_id, v_is_revote, p_target_id, p_is_no_imposter)
  on conflict (round_id, voter_id, is_revote)
  do update set
    target_player_id = excluded.target_player_id,
    is_no_imposter = excluded.is_no_imposter,
    locked_at = now();

  -- Count eligible vs locked
  select count(*)::int into v_total_eligible
  from public.players
  where room_id = v_room.id and connection <> 'disconnected' and not is_eliminated;

  select count(*)::int into v_total_locked
  from public.votes
  where round_id = p_round_id and is_revote = v_is_revote;

  -- If not all votes locked, return progress count only (never choices)
  if v_total_locked < v_total_eligible then
    return jsonb_build_object(
      'ok', true,
      'allLocked', false,
      'lockedCount', v_total_locked,
      'eligibleCount', v_total_eligible
    );
  end if;

  -- ALL VOTES LOCKED: Authoritatively resolve the tally using pure aggregation
  -- This approach avoids the conditional syntax error when there are no votes or ties
  select
    coalesce(max(vote_count), 0)::int,
    count(*)::int
  into v_max_votes, v_leader_count
  from (
    select count(*)::int as vote_count
    from public.votes
    where round_id = p_round_id and is_revote = v_is_revote
    group by target_player_id
  ) c;

  -- Build the list of tied suspects if leader_count > 1
  if v_leader_count > 1 then
    select array_agg(target_player_id) into v_tied_ids
    from (
      select target_player_id, count(*)::int as vote_count
      from public.votes
      where round_id = p_round_id and is_revote = v_is_revote
      group by target_player_id
    ) c2
    where c2.vote_count = v_max_votes;
  else
    -- Single winner
    select target_player_id into v_winner_id
    from (
      select target_player_id, count(*)::int as vote_count
      from public.votes
      where round_id = p_round_id and is_revote = v_is_revote
      group by target_player_id
    ) c3
    where c3.vote_count = v_max_votes;
  end if;

  -- Check for a tie at the top
  if coalesce(v_leader_count, 0) > 1 then
    if not v_is_revote then
      -- First vote tied -> trigger tied_revote
      update public.rounds
      set is_revote = true, revote_candidates = v_tied_ids
      where id = p_round_id;

      update public.rooms
      set phase = 'tied_revote', version = version + 1, last_activity_at = now()
      where id = v_room.id;

      return jsonb_build_object('ok', true, 'tied', true, 'revote', true);
    else
      -- Revote tied again -> nobody is eliminated, imposter survives
      v_winner_id := null;
    end if;
  end if;

  -- Determine if eliminated player is imposter
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

  -- If caught imposter -> move to imposter_final_guess
  -- If innocent or nobody eliminated -> move directly to round_result
  if v_eliminated_is_imposter then
    update public.rooms
    set phase = 'imposter_final_guess', version = version + 1, last_activity_at = now()
    where id = v_room.id;
  else
    -- Finalize round result directly
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


-- 3. FINALIZE ROUND SCORING INTERNAL HELPER
create or replace function public.finalize_round_scoring(
  p_round_id uuid,
  p_final_guess_correct boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_round record;
  v_room record;
  v_secret record;
  v_eliminated_id uuid;
  v_eliminated_was_imp boolean := false;
  v_p record;
  v_vote record;
  v_is_imp boolean;
  v_points integer;
  v_reasons text[];
  v_score_lines jsonb := '[]'::jsonb;
  v_tallies jsonb;
  v_imp_ids uuid[];
  v_is_revote boolean;
begin
  select * into v_round from public.rounds where id = p_round_id;
  select * into v_room from public.rooms where id = v_round.room_id;
  select * into v_secret from public.round_secrets where round_id = p_round_id;

  v_eliminated_id := v_round.eliminated_player_id;
  v_is_revote := v_round.is_revote;

  -- Imposter IDs
  select array_agg(player_id) into v_imp_ids
  from public.round_roles
  where round_id = p_round_id and role = 'imposter';

  if v_eliminated_id is not null then
    v_eliminated_was_imp := (v_eliminated_id = any(v_imp_ids));
  end if;

  -- Build tallies JSON
  select jsonb_agg(
    jsonb_build_object(
      'targetId', target_player_id,
      'isNoImposter', is_no_imposter,
      'count', count(*)::int
    )
  ) into v_tallies
  from public.votes
  where round_id = p_round_id and is_revote = v_is_revote
  group by target_player_id, is_no_imposter;

  -- Score each player according to the official rules
  for v_p in (select * from public.players where room_id = v_room.id and removed_at is null) loop
    v_points := 0;
    v_reasons := '{}';
    v_is_imp := (v_p.id = any(v_imp_ids));

    if not v_is_imp then
      -- Regular player rules:
      -- +1 for voting for an imposter
      select * into v_vote
      from public.votes
      where round_id = p_round_id and voter_id = v_p.id and is_revote = v_is_revote;

      if found and v_vote.target_player_id is not null and (v_vote.target_player_id = any(v_imp_ids)) then
        v_points := v_points + 1;
        v_reasons := array_append(v_reasons, 'Voted for an Imposter (+1)');
      end if;

      -- +1 when the group catches an imposter
      if v_eliminated_was_imp then
        v_points := v_points + 1;
        v_reasons := array_append(v_reasons, 'Group caught an Imposter (+1)');
      end if;
    else
      -- Imposter rules:
      -- +3 for avoiding elimination
      if v_eliminated_id is distinct from v_p.id then
        v_points := v_points + 3;
        v_reasons := array_append(v_reasons, 'Avoided elimination (+3)');
      else
        -- Caught imposter: +2 if final word guess is correct
        if p_final_guess_correct = true then
          v_points := v_points + 2;
          v_reasons := array_append(v_reasons, 'Guessed the secret word correctly (+2)');
        end if;
      end if;
    end if;

    -- Update player's cumulative score in database
    update public.players
    set score = score + v_points
    where id = v_p.id;

    v_score_lines := v_score_lines || jsonb_build_array(
      jsonb_build_object(
        'playerId', v_p.id,
        'nickname', v_p.nickname,
        'points', v_points,
        'reasons', to_jsonb(v_reasons)
      )
    );
  end loop;

  -- Insert round result summary (word revealed only now)
  insert into public.round_results (
    round_id, tallies, imposter_player_ids, eliminated_player_id,
    eliminated_was_imposter, secret_word, final_guess_correct, score_lines
  )
  values (
    p_round_id,
    coalesce(v_tallies, '[]'::jsonb),
    coalesce(v_imp_ids, '{}'),
    v_eliminated_id,
    v_eliminated_was_imp,
    v_secret.secret_word,
    p_final_guess_correct,
    v_score_lines
  )
  on conflict (round_id) do nothing;
end;
$$;
