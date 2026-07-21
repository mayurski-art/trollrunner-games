-- ============================================================================
-- Troll High — the SHARED class yearbook (design doc §23 Phase 6,
-- "Multiplayer Memories" — shared yearbooks / class photos slice).
-- Run ONCE in the Supabase SQL editor (project tjsyhfplxjtakdfkpdtg), same
-- project as troll_high_yearbook.sql (already run — that one's storage
-- bucket is reused here unchanged, this only adds a small metadata table).
--
-- The personal Yearbook (troll_high_yearbook.sql) already uploads photo
-- BYTES to a public-read storage bucket — the URL alone is enough for
-- anyone to view a photo, no auth needed. What's missing for a SHARED
-- yearbook is a place OTHER players can discover that a photo exists at
-- all: each player's own photo list currently lives only inside their own
-- troll_game_saves row, which is owner-only RLS. This table is that
-- public index — every photo any player takes is added here too (see
-- camera.js's sharePhoto()), so the Class Yearbook view in-game can just
-- select-all and render them, most recent first.
-- ============================================================================

create table if not exists troll_high_shared_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  path text not null,
  url text not null,
  zone_id text,
  zone_name text,
  event_tag text,
  taken_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists troll_high_shared_photos_taken_at_idx
  on troll_high_shared_photos (taken_at desc);

alter table troll_high_shared_photos enable row level security;

-- Anyone can read the shared yearbook — that's the whole point.
drop policy if exists "public read troll_high_shared_photos" on troll_high_shared_photos;
create policy "public read troll_high_shared_photos"
  on troll_high_shared_photos for select
  using (true);

-- A player may only add photos under their own account.
drop policy if exists "own insert troll_high_shared_photos" on troll_high_shared_photos;
create policy "own insert troll_high_shared_photos"
  on troll_high_shared_photos for insert to authenticated
  with check (auth.uid() = user_id);

-- A player may remove their own contributed photos (mirrors the personal
-- Yearbook's own-folder delete policy on the storage bucket).
drop policy if exists "own delete troll_high_shared_photos" on troll_high_shared_photos;
create policy "own delete troll_high_shared_photos"
  on troll_high_shared_photos for delete to authenticated
  using (auth.uid() = user_id);
