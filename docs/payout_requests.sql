-- ============================================================================
-- Troll Runner Arcade — payout_requests
-- Run ONCE in the Supabase SQL editor (project tjsyhfplxjtakdfkpdtg).
--
-- Stores manual winnings-approval requests submitted by players who staked a
-- real wager and won. The DEVELOPER reviews these (Table Editor / service role),
-- verifies the on-chain stake (stake_tx) landed in the treasury, confirms the
-- result, then pays the winner MANUALLY. There are no automated payouts.
--
-- ACCESS: the public anon key may INSERT a claim but CANNOT read any rows
-- (no select policy). Only you (dashboard / service role) can read them.
-- ============================================================================

create table if not exists public.payout_requests (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  status          text not null default 'pending',   -- you update: approved | paid | rejected

  game            text,              -- e.g. 'troll-kombat'
  match_id        text,              -- client-generated unique id for the match
  wallet          text,              -- claimant's payout address (connected Phantom)

  -- the real stake the player paid IN (proof + amount)
  stake_token     text,              -- 'USDC' | 'TROLL'
  stake_amount    numeric,           -- amount the player typed
  stake_usd       numeric,           -- USD value charged at pay time
  stake_tx        text,              -- on-chain signature — VERIFY THIS before paying
  network         text,              -- 'mainnet-beta'

  -- match context (so you can sanity-check the claim)
  mode            text,              -- 'cpu' | 'mp'
  difficulty      int,               -- cpu difficulty (0/1/2) or null
  player_fighter  text,              -- claimant's character id
  opponent_fighter text,             -- opponent character id
  stage           text,

  -- outcome
  won             boolean,           -- did the claimant win
  winner          text,              -- 'player' | 'cpu' | 'p1' | 'p2'
  rounds_won      int,
  rounds_lost     int,
  kos             int,
  damage          int,

  -- bookkeeping / anti-abuse aids
  claim_nonce     text,              -- client reference shown to the player
  app_version     text,
  user_agent      text
);

-- Helpful for review + de-duping by the on-chain stake signature.
create index if not exists payout_requests_created_idx on public.payout_requests (created_at desc);
create unique index if not exists payout_requests_stake_tx_uidx
  on public.payout_requests (stake_tx) where stake_tx is not null;

alter table public.payout_requests enable row level security;

-- Anyone may submit a claim …
drop policy if exists "anon insert payout requests" on public.payout_requests;
create policy "anon insert payout requests"
  on public.payout_requests for insert to anon, authenticated
  with check (true);

-- … but NO anon/authenticated select/update/delete policy exists, so reads and
-- edits are blocked for the public key. Review with the dashboard / service role.
