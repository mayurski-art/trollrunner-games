-- ============================================================================
-- Troll High — yearbook photo storage
-- Run ONCE in the Supabase SQL editor (project tjsyhfplxjtakdfkpdtg).
--
-- Backs the disposable-camera / yearbook feature: players capture the
-- current game view and it's uploaded here, then shown back to them in
-- their own in-game Yearbook overlay. No new table — the list of photos
-- (storage path + timestamp + zone) lives in the same troll_game_saves
-- JSONB row every other Troll High save data already uses; this bucket
-- just holds the actual image bytes.
--
-- ACCESS: photos are PUBLIC READ (so a photo's URL works directly in an
-- <img> tag with no auth dance), but a player may only upload or delete
-- files inside a folder named after their own auth.uid() — enforced by
-- storage.foldername(name), the standard Supabase Storage RLS pattern.
-- Uploads use the same authenticated client save.js already uses
-- (TrollrunnerAccounts.getClient()), not a fresh anon client, so
-- auth.uid() resolves correctly here.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('troll-high-photos', 'troll-high-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read troll-high-photos" on storage.objects;
create policy "public read troll-high-photos"
  on storage.objects for select
  using (bucket_id = 'troll-high-photos');

drop policy if exists "own-folder insert troll-high-photos" on storage.objects;
create policy "own-folder insert troll-high-photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'troll-high-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own-folder delete troll-high-photos" on storage.objects;
create policy "own-folder delete troll-high-photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'troll-high-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
