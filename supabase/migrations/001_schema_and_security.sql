-- ============================================================================
-- IMPOSTER: SECRET SIGNAL
-- Migration 001 - Tables, indexes and security rules
-- ============================================================================
--
-- THE ONE IDEA THAT MATTERS
-- Players' phones may READ a small amount of harmless information directly.
-- They may NOT WRITE anything at all. Every change to the game happens through
-- a validated function (added in migration 002). That is what makes the
-- database, not the phone, the authority on who the imposter is.
--
-- HOW PRIVACY IS ENFORCED
--   1. Secrets live in tables with NO access granted to anybody.
--      Even a player with a browser console cannot query them.
--   2. Per-player private data lives in tables where a player can read
--      ONLY their own row, enforced by the database itself.
--   3. Public room state contains no roles, no words and no vote targets.
--
-- Safe to run more than once.
-- ============================================================================


-- ORDER MATTERS
-- Tables are created first, then the helper functions that read them, then
-- the security rules that use those helpers. A function cannot refer to a
-- table that does not exist yet.


-- ----------------------------------------------------------------------------
-- 1. ROOMS
-- ----------------------------------------------------------------------------

create table if not exists public.rooms (
  id                uuid primary key default gen_random_uuid(),

  -- The 4-character code people read out loud. Uppercase, no confusable
  -- characters. Uniqueness is enforced among rooms that are still open.
  code              text not null,

  -- Current phase of the state machine. Only functions may change it.
  phase             text not null default 'lobby',

  -- Increases on every committed change. A phone sends the version it last
  -- saw; if it is behind, its request is rejected as stale.
  version           bigint not null default 1,

  game_mode         text not null default 'standard',

  -- Host settings as chosen in the lobby.
  settings          jsonb not null default '{}'::jsonb,

  host_player_id    uuid,
  is_locked         boolean not null default false,
  current_round_id  uuid,
  round_number      integer not null default 0,

  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now(),

  -- Inactive rooms expire after two hours and are then deleted outright.
  expires_at        timestamptz not null default now() + interval '2 hours',
  closed_at         timestamptz,

  constraint rooms_phase_valid check (phase in (
    'lobby','configuring','assigning_roles','private_role_reveal','clue_turn',
    'discussion','voting','tied_revote','vote_result','imposter_final_guess',
    'round_result','scoreboard','next_round','match_result','room_closed'
  )),
  constraint rooms_mode_valid check (game_mode in (
    'standard','three_player','double_agent'
  )),
  constraint rooms_code_shape check (code ~ '^[ACDEFGHJKMNPQRTUVWXY34679]{4}$')
);

-- A code may be reused once the old room has closed, but never while two
-- rooms are both live.
create unique index if not exists rooms_active_code_unique
  on public.rooms (code)
  where closed_at is null;

create index if not exists rooms_expires_at_idx on public.rooms (expires_at);


-- ----------------------------------------------------------------------------
-- 2. PLAYERS
-- ----------------------------------------------------------------------------

create table if not exists public.players (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.rooms(id) on delete cascade,

  -- The anonymous session this seat belongs to. This IS the reconnect token:
  -- it lives in the phone's own storage and is never sent to anyone else.
  user_id            uuid not null,

  nickname           text not null,

  -- Lowercased, spaces removed. Used only to detect duplicates.
  nickname_key       text not null,

  is_host            boolean not null default false,
  connection         text not null default 'connected',

  -- Standard-mode score. Kept separate from the experimental mode on purpose.
  score              integer not null default 0,
  experimental_score integer not null default 0,

  is_eliminated      boolean not null default false,

  joined_at          timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),

  -- Set when the host removes somebody, or when they leave for good.
  removed_at         timestamptz,

  constraint players_connection_valid check (connection in (
    'connected','reconnecting','disconnected'
  )),
  constraint players_nickname_length check (char_length(nickname) between 2 and 16)
);

-- Nicknames are unique within a room, compared case-insensitively.
create unique index if not exists players_room_nickname_unique
  on public.players (room_id, nickname_key)
  where removed_at is null;

-- One seat per device per room. This is what stops a reconnecting phone from
-- appearing twice in the player list.
create unique index if not exists players_room_user_unique
  on public.players (room_id, user_id)
  where removed_at is null;

-- Exactly one host per room, enforced by the database rather than by code.
create unique index if not exists players_one_host_per_room
  on public.players (room_id)
  where is_host and removed_at is null;

create index if not exists players_room_idx on public.players (room_id);
create index if not exists players_user_idx on public.players (user_id);


-- ----------------------------------------------------------------------------
-- 3. ROUNDS  (public, non-secret part)
-- ----------------------------------------------------------------------------
-- Everything here is safe for the whole room to see. The secret word and the
-- roles are deliberately NOT in this table.

create table if not exists public.rounds (
  id                   uuid primary key default gen_random_uuid(),
  room_id              uuid not null references public.rooms(id) on delete cascade,
  round_number         integer not null,

  -- The frozen speaking order, decided once and never recalculated.
  clue_order           uuid[] not null default '{}',
  current_turn_index   integer not null default 0,

  is_revote            boolean not null default false,
  revote_candidates    uuid[],

  eliminated_player_id uuid,
  final_guess_correct  boolean,

  created_at           timestamptz not null default now(),
  resolved_at          timestamptz,

  unique (room_id, round_number)
);

create index if not exists rounds_room_idx on public.rounds (room_id);


-- ----------------------------------------------------------------------------
-- 4. ROUND SECRETS  -- NOBODY CAN READ THIS TABLE
-- ----------------------------------------------------------------------------
-- The secret word lives here, apart from everything a player may query.
-- No SELECT permission is granted to anyone below. Only the game's own
-- functions can see inside it.

create table if not exists public.round_secrets (
  round_id      uuid primary key references public.rounds(id) on delete cascade,
  secret_word   text not null,
  category      text not null,
  imposter_info text not null,

  constraint round_secrets_info_valid check (imposter_info in (
    'no_word','category_hint'
  ))
);

comment on table public.round_secrets is
  'The secret word. No role has permission to read this table. Functions only.';


-- ----------------------------------------------------------------------------
-- 5. ROUND ROLES  -- EACH PLAYER SEES ONLY THEIR OWN ROW
-- ----------------------------------------------------------------------------
-- This is the one place a player learns what they are. The security rule
-- below makes another player's row invisible, not merely hidden in the
-- interface: a request for it returns nothing at all.

create table if not exists public.round_roles (
  round_id        uuid not null references public.rounds(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,

  role            text not null,

  -- Filled in for regular players. Always NULL for an imposter, so there is
  -- no word to leak even if something else goes wrong.
  secret_word     text,

  -- Regular players always see this. Imposters see it only with Category Hint.
  category        text,

  instruction     text not null,
  acknowledged_at timestamptz,

  primary key (round_id, player_id),
  constraint round_roles_role_valid check (role in ('regular','imposter')),

  -- Belt and braces: an imposter row can never carry the secret word.
  constraint round_roles_imposter_has_no_word check (
    role <> 'imposter' or secret_word is null
  )
);

create index if not exists round_roles_player_idx on public.round_roles (player_id);


-- ----------------------------------------------------------------------------
-- 6. VOTES  -- EACH PLAYER SEES ONLY THEIR OWN VOTE
-- ----------------------------------------------------------------------------

create table if not exists public.votes (
  round_id         uuid not null references public.rounds(id) on delete cascade,
  voter_id         uuid not null references public.players(id) on delete cascade,

  -- A revote is stored separately so the original vote is never overwritten.
  is_revote        boolean not null default false,

  target_player_id uuid references public.players(id) on delete set null,

  -- Only used in the two-player experimental mode.
  is_no_imposter   boolean not null default false,

  locked_at        timestamptz not null default now(),

  primary key (round_id, voter_id, is_revote),

  -- A vote is either for a player or for "no imposter", never both or neither.
  constraint votes_one_choice check (
    (target_player_id is not null and not is_no_imposter)
    or (target_player_id is null and is_no_imposter)
  ),

  -- Nobody votes for themselves, enforced by the database.
  constraint votes_no_self_vote check (target_player_id is distinct from voter_id)
);

create index if not exists votes_round_idx on public.votes (round_id);


-- ----------------------------------------------------------------------------
-- 7. ROUND RESULTS  -- published only once the result is final
-- ----------------------------------------------------------------------------
-- Nothing is written here until scoring is complete. That is what prevents
-- anyone, including the host, from inspecting votes early.

create table if not exists public.round_results (
  round_id                uuid primary key references public.rounds(id) on delete cascade,

  tallies                 jsonb not null,
  imposter_player_ids     uuid[] not null,
  eliminated_player_id    uuid,
  eliminated_was_imposter boolean not null default false,

  -- Revealed to everybody at this point, and not before.
  secret_word             text not null,
  final_guess_correct     boolean,

  score_lines             jsonb not null,

  -- The host may turn this on afterwards, if the setting allows it.
  votes_revealed          boolean not null default false,
  vote_details            jsonb,

  created_at              timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 8. WORD BANK  -- not readable by players
-- ----------------------------------------------------------------------------
-- If a phone could read the word list it could narrow down the answer, so
-- no read permission is granted. Words are drawn by a function.

create table if not exists public.word_bank (
  id         uuid primary key default gen_random_uuid(),
  word       text not null,
  category   text not null,
  difficulty text not null default 'medium',
  region     text not null default 'global',
  age_group  text not null default 'family',

  constraint word_bank_difficulty_valid check (difficulty in ('easy','medium','hard')),
  constraint word_bank_age_valid check (age_group in ('family','teen','adult'))
);

create unique index if not exists word_bank_word_category_unique
  on public.word_bank (lower(word), lower(category));

create index if not exists word_bank_filter_idx
  on public.word_bank (difficulty, age_group, region, category);


-- ----------------------------------------------------------------------------
-- 9. ACTION LOG  -- stops double taps from acting twice
-- ----------------------------------------------------------------------------
-- Every state-changing request carries a one-off key. The unique index means
-- a second attempt with the same key simply cannot be recorded, so a double
-- tap advances one turn rather than two.

create table if not exists public.action_log (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  player_id       uuid,
  action          text not null,
  idempotency_key text not null,
  created_at      timestamptz not null default now(),

  unique (room_id, idempotency_key)
);

create index if not exists action_log_room_idx on public.action_log (room_id);


-- ----------------------------------------------------------------------------
-- 10. HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
-- These answer "which rooms is the person making this request actually in?".
-- They are SECURITY DEFINER so they can look at the players table without
-- triggering the very security rules they are used to evaluate.
--
-- They are created AFTER the players table, because a function cannot read a
-- table that does not exist yet.

create or replace function public.current_player_room_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select room_id
  from public.players
  where user_id = auth.uid()
    and removed_at is null
$$;

comment on function public.current_player_room_ids is
  'Rooms the current anonymous session belongs to. Used by security rules.';


create or replace function public.current_player_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select id
  from public.players
  where user_id = auth.uid()
    and removed_at is null
$$;

comment on function public.current_player_ids is
  'Player rows owned by the current anonymous session.';


-- ----------------------------------------------------------------------------
-- 11. TURN ON ROW LEVEL SECURITY EVERYWHERE
-- ----------------------------------------------------------------------------
-- With this on and no policy written, a table is closed to everyone. We then
-- open the narrowest possible gaps, one at a time.

alter table public.rooms         enable row level security;
alter table public.players       enable row level security;
alter table public.rounds        enable row level security;
alter table public.round_secrets enable row level security;
alter table public.round_roles   enable row level security;
alter table public.votes         enable row level security;
alter table public.round_results enable row level security;
alter table public.word_bank     enable row level security;
alter table public.action_log    enable row level security;

-- Also force it for the table owner, so a mistake elsewhere cannot bypass it.
alter table public.round_secrets force row level security;
alter table public.round_roles   force row level security;
alter table public.votes         force row level security;


-- ----------------------------------------------------------------------------
-- 12. READ RULES
-- ----------------------------------------------------------------------------

-- Rooms: visible only to people who are in them.
-- Looking a room up by code happens through the join function, so there is no
-- way to go fishing for other people's rooms.
drop policy if exists rooms_select_members on public.rooms;
create policy rooms_select_members on public.rooms
  for select to authenticated
  using (id in (select public.current_player_room_ids()));

-- Players: everyone in the room sees the public player list.
-- Note which columns exist on this table: nickname, host flag, connection,
-- score. No role, no word, no vote.
drop policy if exists players_select_same_room on public.players;
create policy players_select_same_room on public.players
  for select to authenticated
  using (room_id in (select public.current_player_room_ids()));

-- Rounds: the non-secret part of the current round.
drop policy if exists rounds_select_members on public.rounds;
create policy rounds_select_members on public.rounds
  for select to authenticated
  using (room_id in (select public.current_player_room_ids()));

-- Private role: your own row, and nobody else's.
-- This single rule is what stops one phone from reading another's identity.
drop policy if exists round_roles_select_own on public.round_roles;
create policy round_roles_select_own on public.round_roles
  for select to authenticated
  using (player_id in (select public.current_player_ids()));

-- Votes: your own vote only, so the count can be shown without the choices.
drop policy if exists votes_select_own on public.votes;
create policy votes_select_own on public.votes
  for select to authenticated
  using (voter_id in (select public.current_player_ids()));

-- Results: readable once they exist, and they only exist after scoring.
drop policy if exists round_results_select_members on public.round_results;
create policy round_results_select_members on public.round_results
  for select to authenticated
  using (
    round_id in (
      select r.id from public.rounds r
      where r.room_id in (select public.current_player_room_ids())
    )
  );

-- round_secrets, word_bank and action_log get NO policies at all.
-- They stay completely closed to every player.


-- ----------------------------------------------------------------------------
-- 13. WRITE RULES: THERE ARE NONE
-- ----------------------------------------------------------------------------
-- No INSERT, UPDATE or DELETE policy is created for any table.
-- A player's phone therefore cannot change a single value directly. Every
-- change goes through a validated function, which is exactly what the
-- "the database is the authority" requirement means in practice.


-- ----------------------------------------------------------------------------
-- 14. PERMISSIONS
-- ----------------------------------------------------------------------------
-- Start by taking everything away, then hand back only the reads above.

revoke all on public.rooms         from anon, authenticated;
revoke all on public.players       from anon, authenticated;
revoke all on public.rounds        from anon, authenticated;
revoke all on public.round_secrets from anon, authenticated;
revoke all on public.round_roles   from anon, authenticated;
revoke all on public.votes         from anon, authenticated;
revoke all on public.round_results from anon, authenticated;
revoke all on public.word_bank     from anon, authenticated;
revoke all on public.action_log    from anon, authenticated;

grant select on public.rooms         to authenticated;
grant select on public.players       to authenticated;
grant select on public.rounds        to authenticated;
grant select on public.round_roles   to authenticated;
grant select on public.votes         to authenticated;
grant select on public.round_results to authenticated;

-- round_secrets, word_bank and action_log: nothing is granted. Deliberate.


-- ----------------------------------------------------------------------------
-- 15. LIVE UPDATES
-- ----------------------------------------------------------------------------
-- These tables push changes to phones in real time. Row Level Security still
-- applies to those messages, so a player is only ever sent rows they were
-- already allowed to read.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Added one at a time, skipping any that are already published, so this
-- whole file can safely be run again.
do $$
declare
  t text;
begin
  foreach t in array array['rooms','players','rounds','round_roles','round_results']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Votes are NOT published. A live feed of vote rows would reveal the timing
-- and shape of other people's choices. The vote count is derived instead.


-- ============================================================================
-- Done. Tables exist, everything is locked, and nothing can be written yet.
-- Migration 002 adds the functions that are allowed to make changes.
-- ============================================================================
