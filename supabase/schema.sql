-- Neon Grid Clash: database-authoritative match state.
-- Run this whole file in Supabase SQL Editor after enabling Anonymous sign-ins.
create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  host_id uuid not null,
  player_ids uuid[] not null default '{}',
  players jsonb not null default '[]'::jsonb,
  board jsonb not null default '[]'::jsonb,
  turn_index integer not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  deadline_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.matches enable row level security;
revoke all on public.matches from anon, authenticated;
grant select on public.matches to authenticated;
drop policy if exists "players can read their own matches" on public.matches;
create policy "players can read their own matches" on public.matches for select to authenticated
  using (auth.uid() = any(player_ids));

create or replace function public.match_payload(m public.matches) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', (m).id, 'room_code', (m).room_code, 'host_id', (m).host_id,
    'players', (m).players, 'board', (m).board, 'turn_index', (m).turn_index,
    'status', (m).status, 'deadline_at', (m).deadline_at,
    'server_now', statement_timestamp()
  );
$$;

create or replace function public.create_match(p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); code text; m public.matches;
begin
  if uid is null then raise exception 'Sign in to create a room.'; end if;
  if length(trim(p_name)) = 0 or length(p_name) > 18 then raise exception 'Callsign must be 1–18 characters.'; end if;
  loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists(select 1 from public.matches where room_code = code);
  end loop;
  insert into public.matches(room_code, host_id, player_ids, players, board)
  values (code, uid, array[uid], jsonb_build_array(jsonb_build_object('id', uid, 'name', trim(p_name), 'score', 0)),
    (select jsonb_agg('null'::jsonb) from generate_series(1, 25))) returning * into m;
  return public.match_payload(m);
end; $$;

create or replace function public.join_match(p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); m public.matches; next_players jsonb;
begin
  if uid is null then raise exception 'Sign in to join a room.'; end if;
  if length(trim(p_name)) = 0 or length(p_name) > 18 then raise exception 'Callsign must be 1–18 characters.'; end if;
  select * into m from public.matches where room_code = upper(trim(p_code)) for update;
  if not found then raise exception 'Room not found. Check the code and try again.'; end if;
  if uid = any(m.player_ids) then return public.match_payload(m); end if;
  if m.status <> 'waiting' then raise exception 'This match has already started.'; end if;
  if cardinality(m.player_ids) >= 4 then raise exception 'This room is full.'; end if;
  next_players := m.players || jsonb_build_array(jsonb_build_object('id', uid, 'name', trim(p_name), 'score', 0));
  update public.matches set player_ids = array_append(player_ids, uid), players = next_players
  where id = m.id returning * into m;
  return public.match_payload(m);
end; $$;

create or replace function public.start_match(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'Sign in to start a room.'; end if;
  select * into m from public.matches where room_code = upper(trim(p_code)) for update;
  if not found or not (uid = any(m.player_ids)) then raise exception 'This room is unavailable to your player.'; end if;
  if uid <> m.host_id then raise exception 'Only the room host can start the match.'; end if;
  if m.status <> 'waiting' then raise exception 'This match has already started.'; end if;
  if cardinality(m.player_ids) < 2 then raise exception 'At least two players are needed to start.'; end if;
  update public.matches set status = 'active', deadline_at = statement_timestamp() + interval '3 minutes'
  where id = m.id returning * into m;
  return public.match_payload(m);
end; $$;

create or replace function public.get_match(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); m public.matches;
begin
  if uid is null then raise exception 'Sign in to reconnect.'; end if;
  select * into m from public.matches where room_code = upper(trim(p_code)) for update;
  if not found or not (uid = any(m.player_ids)) then raise exception 'This room is unavailable to your player.'; end if;
  if m.status = 'active' and m.deadline_at <= statement_timestamp() then
    update public.matches set status = 'finished' where id = m.id returning * into m;
  end if;
  return public.match_payload(m);
end; $$;

create or replace function public.claim_tile(p_code text, p_index integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); m public.matches; player jsonb; pts integer;
begin
  if uid is null then raise exception 'Sign in to claim a tile.'; end if;
  if p_index < 0 or p_index > 24 then raise exception 'That tile is outside the board.'; end if;
  select * into m from public.matches where room_code = upper(trim(p_code)) for update;
  if not found or not (uid = any(m.player_ids)) then raise exception 'This room is unavailable to your player.'; end if;
  if m.status <> 'active' then raise exception 'This match is not accepting moves.'; end if;
  if m.deadline_at <= statement_timestamp() then
    update public.matches set status = 'finished' where id = m.id returning * into m;
    return public.match_payload(m);
  end if;
  if (m.players -> m.turn_index ->> 'id')::uuid <> uid then raise exception 'It is not your turn yet.'; end if;
  if m.board -> p_index <> 'null'::jsonb then raise exception 'That tile is already claimed.'; end if;
  pts := case when p_index = any(array[2,6,8,12,16,18,22]) then 3 else 1 end;
  update public.matches set
    board = jsonb_set(board, array[p_index::text], jsonb_build_object('player_id', uid, 'points', pts)),
    players = jsonb_set(players, array[turn_index::text, 'score'], to_jsonb(((players -> turn_index ->> 'score')::integer) + pts)),
    turn_index = (turn_index + 1) % cardinality(player_ids)
  where id = m.id returning * into m;
  if not exists(select 1 from jsonb_array_elements(m.board) tile where tile = 'null'::jsonb) then
    update public.matches set status = 'finished' where id = m.id returning * into m;
  end if;
  return public.match_payload(m);
end; $$;

revoke all on function public.match_payload(public.matches) from public, anon, authenticated;
revoke all on function public.create_match(text) from public;
revoke all on function public.join_match(text, text) from public;
revoke all on function public.start_match(text) from public;
revoke all on function public.get_match(text) from public;
revoke all on function public.claim_tile(text, integer) from public;
grant execute on function public.create_match(text) to authenticated;
grant execute on function public.join_match(text, text) to authenticated;
grant execute on function public.start_match(text) to authenticated;
grant execute on function public.get_match(text) to authenticated;
grant execute on function public.claim_tile(text, integer) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null;
end $$;
