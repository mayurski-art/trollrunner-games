-- Trollrreria 3D — phase 9 cloud saves.
-- Run once in the Supabase SQL editor for the project Net.js/CloudSave.js
-- already point at (tjsyhfplxjtakdfkpdtg). Anon-key only, no accounts: a
-- save is keyed by a 5-letter code the player picks/enters themselves,
-- same UX as the existing co-op room codes.

create table if not exists public.tr3_cloud_saves (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.tr3_cloud_saves enable row level security;

-- Anon key can read/write any row — there's no auth layer here, a save's
-- code IS its access control (same trust model as a co-op room code).
-- Whoever has the code can load or overwrite that save.
create policy "anon can read cloud saves" on public.tr3_cloud_saves
  for select to anon using (true);

create policy "anon can upsert cloud saves" on public.tr3_cloud_saves
  for insert to anon with check (true);

create policy "anon can update cloud saves" on public.tr3_cloud_saves
  for update to anon using (true) with check (true);
