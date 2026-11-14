-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 007 - Fix result tally aggregation
-- ============================================================================

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

  select array_agg(player_id) into v_imp_ids
  from public.round_roles
  where round_id = p_round_id and role = 'imposter';

  if v_eliminated_id is not null then
    v_eliminated_was_imp := (v_eliminated_id = any(v_imp_ids));
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'targetId', tally.target_player_id,
      'isNoImposter', tally.is_no_imposter,
      'count', tally.vote_count
    )
  ) into v_tallies
  from (
    select target_player_id, is_no_imposter, count(*)::int as vote_count
    from public.votes
    where round_id = p_round_id and is_revote = v_is_revote
    group by target_player_id, is_no_imposter
  ) tally;

  for v_p in (select * from public.players where room_id = v_room.id and removed_at is null) loop
    v_points := 0;
    v_reasons := '{}';
    v_is_imp := (v_p.id = any(v_imp_ids));

    if not v_is_imp then
      select * into v_vote
      from public.votes
      where round_id = p_round_id and voter_id = v_p.id and is_revote = v_is_revote;

      if found and v_vote.target_player_id is not null and (v_vote.target_player_id = any(v_imp_ids)) then
        v_points := v_points + 1;
        v_reasons := array_append(v_reasons, 'Voted for an Imposter (+1)');
      end if;

      if v_eliminated_was_imp then
        v_points := v_points + 1;
        v_reasons := array_append(v_reasons, 'Group caught an Imposter (+1)');
      end if;
    else
      if v_eliminated_id is distinct from v_p.id then
        v_points := v_points + 3;
        v_reasons := array_append(v_reasons, 'Avoided elimination (+3)');
      elsif p_final_guess_correct = true then
        v_points := v_points + 2;
        v_reasons := array_append(v_reasons, 'Guessed the secret word correctly (+2)');
      end if;
    end if;

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
