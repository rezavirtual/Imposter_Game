-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 002 - Secure Game Functions (RPCs) & Word Bank Seed
-- ============================================================================
-- All state mutations happen here with SECURITY DEFINER.
-- Client browsers call these functions and cannot alter tables directly.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. WORD BANK STARTER PACK
-- ----------------------------------------------------------------------------
insert into public.word_bank (word, category, difficulty, region, age_group)
values
  -- Animals
  ('Elephant', 'Animals', 'easy', 'global', 'family'),
  ('Penguin', 'Animals', 'easy', 'global', 'family'),
  ('Kangaroo', 'Animals', 'easy', 'global', 'family'),
  ('Chameleon', 'Animals', 'medium', 'global', 'family'),
  ('Octopus', 'Animals', 'medium', 'global', 'family'),
  ('Platypus', 'Animals', 'hard', 'global', 'family'),
  ('Narwhal', 'Animals', 'hard', 'global', 'family'),

  -- Food & Drinks
  ('Pizza', 'Food', 'easy', 'global', 'family'),
  ('Sushi', 'Food', 'easy', 'global', 'family'),
  ('Pancake', 'Food', 'easy', 'global', 'family'),
  ('Guacamole', 'Food', 'medium', 'global', 'family'),
  ('Croissant', 'Food', 'medium', 'global', 'family'),
  ('Truffle', 'Food', 'hard', 'global', 'family'),
  ('Saffron', 'Food', 'hard', 'global', 'family'),

  -- Places & Travel
  ('Airport', 'Places', 'easy', 'global', 'family'),
  ('Library', 'Places', 'easy', 'global', 'family'),
  ('Museum', 'Places', 'easy', 'global', 'family'),
  ('Submarine', 'Places', 'medium', 'global', 'family'),
  ('Lighthouse', 'Places', 'medium', 'global', 'family'),
  ('Observatory', 'Places', 'hard', 'global', 'family'),

  -- Everyday Objects
  ('Umbrella', 'Objects', 'easy', 'global', 'family'),
  ('Backpack', 'Objects', 'easy', 'global', 'family'),
  ('Flashlight', 'Objects', 'easy', 'global', 'family'),
  ('Compass', 'Objects', 'medium', 'global', 'family'),
  ('Hourglass', 'Objects', 'medium', 'global', 'family'),
  ('Metronome', 'Objects', 'hard', 'global', 'family'),

  -- Occupations
  ('Astronaut', 'Jobs', 'easy', 'global', 'family'),
  ('Detective', 'Jobs', 'easy', 'global', 'family'),
  ('Chef', 'Jobs', 'easy', 'global', 'family'),
  ('Archaeologist', 'Jobs', 'medium', 'global', 'family'),
  ('Blacksmith', 'Jobs', 'medium', 'global', 'family'),
  ('Cartographer', 'Jobs', 'hard', 'global', 'family')
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- 2. CREATE ROOM
-- ----------------------------------------------------------------------------
create or replace function public.create_room(
  p_nickname text,
  p_settings jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room_id uuid;
  v_player_id uuid;
  v_code text;
  v_alphabet text := 'ACDEFGHJKMNPQRTUVWXY34679';
  v_attempts integer := 0;
  v_nick_clean text;
  v_nick_key text;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_nick_clean := trim(p_nickname);
  if length(v_nick_clean) < 2 or length(v_nick_clean) > 16 then
    raise exception 'Nickname must be between 2 and 16 characters';
  end if;
  v_nick_key := lower(regexp_replace(v_nick_clean, '\s+', '', 'g'));

  -- Generate unique 4-character code
  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 100 then
      raise exception 'Unable to generate unique room code';
    end if;

    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alphabet, (floor(random() * length(v_alphabet))::int + 1), 1);
    end loop;

    exit when not exists (select 1 from public.rooms where code = v_code and closed_at is null);
  end loop;

  -- Create room
  insert into public.rooms (code, settings)
  values (v_code, p_settings)
  returning id into v_room_id;

  -- Create host player
  insert into public.players (room_id, user_id, nickname, nickname_key, is_host)
  values (v_room_id, v_user_id, v_nick_clean, v_nick_key, true)
  returning id into v_player_id;

  -- Link host player back to room
  update public.rooms
  set host_player_id = v_player_id
  where id = v_room_id;

  return jsonb_build_object(
    'roomId', v_room_id,
    'playerId', v_player_id,
    'code', v_code
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. JOIN ROOM
-- ----------------------------------------------------------------------------
create or replace function public.join_room(
  p_code text,
  p_nickname text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room record;
  v_player_id uuid;
  v_existing_player record;
  v_nick_clean text;
  v_nick_key text;
  v_player_count integer;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  v_nick_clean := trim(p_nickname);
  if length(v_nick_clean) < 2 or length(v_nick_clean) > 16 then
    raise exception 'Nickname must be between 2 and 16 characters';
  end if;
  v_nick_key := lower(regexp_replace(v_nick_clean, '\s+', '', 'g'));

  -- Find room
  select * into v_room
  from public.rooms
  where code = upper(trim(p_code))
    and closed_at is null;

  if not found then
    raise exception 'Room not found or has closed';
  end if;

  if v_room.is_locked then
    raise exception 'Room is locked by the host';
  end if;

  -- Check if this anonymous session is already in this room (reconnection)
  select * into v_existing_player
  from public.players
  where room_id = v_room.id
    and user_id = v_user_id
    and removed_at is null;

  if found then
    -- Player is reconnecting
    update public.players
    set connection = 'connected', last_seen_at = now()
    where id = v_existing_player.id;

    return jsonb_build_object(
      'roomId', v_room.id,
      'playerId', v_existing_player.id,
      'code', v_room.code,
      'isHost', v_existing_player.is_host,
      'reconnected', true
    );
  end if;

  -- Check player count (max 10)
  select count(*) into v_player_count
  from public.players
  where room_id = v_room.id and removed_at is null;

  if v_player_count >= 10 then
    raise exception 'Room is full (maximum 10 players)';
  end if;

  -- Check nickname uniqueness
  if exists (
    select 1 from public.players
    where room_id = v_room.id
      and nickname_key = v_nick_key
      and removed_at is null
  ) then
    raise exception 'Nickname already taken in this room';
  end if;

  -- Insert new player
  insert into public.players (room_id, user_id, nickname, nickname_key, is_host)
  values (v_room.id, v_user_id, v_nick_clean, v_nick_key, false)
  returning id into v_player_id;

  return jsonb_build_object(
    'roomId', v_room.id,
    'playerId', v_player_id,
    'code', v_room.code,
    'isHost', false,
    'reconnected', false
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. HEARTBEAT / RECONNECT CHECK
-- ----------------------------------------------------------------------------
create or replace function public.player_heartbeat(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.players
  set last_seen_at = now(), connection = 'connected'
  where id = p_player_id
    and user_id = auth.uid()
    and removed_at is null;
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. GRANT RPC PERMISSIONS
-- ----------------------------------------------------------------------------
grant execute on function public.create_room(text, jsonb) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.player_heartbeat(uuid) to authenticated;
