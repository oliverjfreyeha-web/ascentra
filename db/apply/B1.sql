-- ASCENTRA B1: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0007_devices_and_sessions (already applied). Applies: 0008_billing.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0008_billing.sql
-- ============================================================

-- B1: plans, trial, checkout and entitlements, kept in sync with Stripe.
-- subscriptions (F3) takes Stripe's lifecycle: trialing, active, past_due, canceled (cancels at the end
-- of the period, access continues until then), ended. Two new tables: the Stripe customer per account,
-- and every Stripe event processed (the webhook's idempotency record). One entitlement row per
-- subscription. The Automatic Renewal Terms v0.1 are published here, word for word as lib/billing-terms.ts.
-- Card details are never stored: Stripe keeps them.
-- Safe with the F6 code: nothing before B1 reads or writes these tables or columns.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0007_devices_and_sessions'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply F6 (0007) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0008_billing');

-- ============ Subscriptions ============

-- No subscription rows exist before B1 (nothing wrote them), so the status set can be replaced.
alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('trialing', 'active', 'past_due', 'canceled', 'ended'));

alter table public.subscriptions
  add column processor_customer_id  text,
  add column processor_price_id     text,
  add column processor_status       text,
  add column cancel_at_period_end   boolean not null default false,
  -- The Stripe event time last applied: an older event never overwrites a newer state.
  add column processor_updated_at   timestamptz;

create index subscriptions_payer on public.subscriptions (payer_account_id, created_at desc);
create index subscriptions_beneficiary on public.subscriptions (beneficiary_account_id, created_at desc);

-- ============ Stripe customers ============

create table public.billing_customers (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null unique references public.accounts (id),
  processor_customer_id  text not null unique,
  retention_class        public.retention_class not null default 'billing',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ============ Stripe events (idempotency) ============

create table public.billing_events (
  id                  uuid primary key default gen_random_uuid(),
  processor_event_id  text not null unique,
  type                text not null,
  account_id          uuid references public.accounts (id),
  outcome             text not null,
  processed_at        timestamptz not null default now(),
  retention_class     public.retention_class not null default 'billing',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ============ Entitlements ============

-- One row per subscription; the server reads it on every request that needs a tier.
create unique index entitlements_one_per_subscription on public.entitlements (subscription_id)
  where subscription_id is not null;
create index entitlements_account on public.entitlements (account_id, valid_until);

-- ============ Automatic Renewal Terms v0.1 ============

insert into public.legal_document_versions (document_key, title, version, status, audience, summary, body, published_at)
values (
  'automatic_renewal_terms', 'Automatic Renewal Terms', 'v0.1', 'published', array['adult'],
  'Monthly automatic renewal: Basic $20, Pro $50, 14-day trial on the first Basic subscription, US only.',
  'ASCENTRA plans renew automatically every month until you cancel. Basic is $20.00 per month and Pro is '
  || '$50.00 per month, in US dollars. Your first subscription to Basic starts with a free 14-day trial: unless '
  || 'you cancel before the trial ends, it converts to Basic and you are charged $20.00 when the trial ends, then '
  || 'every month on that date. Pro is charged when you subscribe, then every month on that date. You can cancel '
  || 'any time from the Billing section of your Account page. You keep access through the end of the trial or of '
  || 'the period you paid for, and you are not charged again. ASCENTRA is available in the United States only.',
  now()
)
on conflict (document_key, version) do nothing;

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['billing_customers', 'billing_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

create index on public.billing_events (account_id);

commit;
