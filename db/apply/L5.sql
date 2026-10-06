-- ASCENTRA L5: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0015_mentor_and_safety (already applied). Applies: 0016_mentor_allowance.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0016_mentor_allowance.sql
-- ============================================================

-- L5: the Mentor allowance, a prepaid monthly add-on to a plan.
--   subscriptions gain the add-on Stripe bills next (0, $5, $10 or $20 a month, in cents) and its Stripe item. The add-on
--   is a second item on the same Stripe subscription as the plan.
--   mentor_allowance_periods: one row per subscription per billing period, with the add-on paid for that period. A
--   raise during the period raises it; a lower amount or a removal only applies from the next period.
--   mentor_allowance_usage: the ledger. One row per Mentor message: its real cost (tokens × the model price table in
--   config) and the amount counted against the allowance. Amounts and ids only, never what was written. Kept as recorded.
--   notices gain the Guardian's 80% and 100% allowance emails.
--   The Mentor Allowance Terms v0.1 are published here, word for word as lib/mentor-allowance-terms.ts.
-- Safe with the L4 code: nothing before L5 reads or writes these columns or tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0015_mentor_and_safety'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply L4 (0015) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0016_mentor_allowance');

-- ============ The add-on on the subscription ============

alter table public.subscriptions
  add column mentor_addon_cents     integer not null default 0,
  add column mentor_addon_price_id  text,
  add column mentor_addon_item_id   text,
  add constraint subscriptions_mentor_addon_amount check (mentor_addon_cents in (0, 500, 1000, 2000)),
  add constraint subscriptions_mentor_addon_item check ((mentor_addon_cents = 0) = (mentor_addon_item_id is null));

-- ============ Allowance per billing period ============

create table public.mentor_allowance_periods (
  id                uuid primary key default gen_random_uuid(),
  subscription_id   uuid not null references public.subscriptions (id),
  account_id        uuid not null references public.accounts (id),   -- the learner (the beneficiary)
  period_start      timestamptz not null,
  period_end        timestamptz not null,
  addon_cents       integer not null default 0 check (addon_cents in (0, 500, 1000, 2000)),
  trial             boolean not null default false,
  retention_class   public.retention_class not null default 'billing',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (subscription_id, period_start),
  check (period_end > period_start)
);
create index on public.mentor_allowance_periods (account_id, period_end desc);

-- ============ The ledger ============

create table public.mentor_allowance_usage (
  id                uuid primary key default gen_random_uuid(),
  period_id         uuid not null references public.mentor_allowance_periods (id),
  account_id        uuid not null references public.accounts (id),
  request_id        text,
  cost_usd          numeric(12, 6) not null check (cost_usd >= 0),       -- the real cost of the message's AI calls
  counted_usd       numeric(12, 6) not null check (counted_usd >= 0),    -- what counts against the allowance
  price_scale       numeric(10, 2) not null default 1 check (price_scale >= 1),  -- above 1 only on a Preview test
  retention_class   public.retention_class not null default 'billing',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on public.mentor_allowance_usage (period_id);
create index on public.mentor_allowance_usage (account_id, created_at desc);

create function private.mentor_usage_is_kept() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ASCENTRA: the Mentor allowance ledger is kept as recorded.' using errcode = 'insufficient_privilege';
end $$;
revoke all on function private.mentor_usage_is_kept() from public;
create trigger mentor_usage_is_kept before update on public.mentor_allowance_usage
  for each row execute function private.mentor_usage_is_kept();

-- ============ The Guardian's allowance emails ============

alter table public.notices drop constraint notices_kind_check;
alter table public.notices add constraint notices_kind_check check (kind in (
  'trial_ending', 'renewal_upcoming', 'payment_failed', 'subscription_canceled',
  'subscription_ended', 'guardian_consent_withdrawn', 'mentor_allowance_80', 'mentor_allowance_100'));

-- ============ Mentor Allowance Terms v0.1 ============

insert into public.legal_document_versions (document_key, title, version, status, audience, summary, body, published_at)
values (
  'mentor_allowance_terms', 'Mentor Allowance Terms', 'v0.1', 'published', array['adult', 'guardian'],
  'An optional prepaid monthly Mentor allowance: Basic $5 or $10, Pro $10 or $20; renews with the plan; raises now, lowers at renewal.',
  $doc$The Mentor allowance is an optional add-on to an ASCENTRA plan that pays for the Mentor's AI use. It is prepaid: $5.00, $10.00 or $20.00 per month in US dollars (Basic: $5.00 or $10.00; Pro: $10.00 or $20.00), charged with your plan on the same date. It renews automatically every month with your plan until you remove it or cancel the plan. Raising it takes effect right away, and you're charged the prorated difference for the rest of the current period, shown before you confirm. Lowering or removing it takes effect at your next renewal; there is no refund for the current period. Part of each month's amount covers running costs, so the usable allowance shown on your meter is less than the amount charged. It resets at each renewal, and unused allowance doesn't carry over. When it runs out, the Mentor pauses until it resets or you raise it; you're never charged more than the amount you chose. During a free trial, the add-on is first charged when the trial converts. A teen's allowance is chosen and paid for by their Guardian.$doc$,
  now()
)
on conflict (document_key, version) do nothing;

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['mentor_allowance_periods', 'mentor_allowance_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

commit;
