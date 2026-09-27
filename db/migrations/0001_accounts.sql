-- F2: Accounts and Profiles.
-- Clerk proves who someone is; these tables hold what they may do.
-- Written only by the server (service role) from verified Clerk webhooks.

create table public.accounts (
  id                        uuid primary key default gen_random_uuid(),
  clerk_user_id             text not null unique,
  email                     text not null,
  email_verified            boolean not null default false,
  role                      text not null check (role in ('owner', 'admin')),
  status                    text not null default 'active' check (status in ('active', 'disabled')),
  password_enabled          boolean not null default false,
  two_factor_enabled        boolean not null default false,
  password_last_updated_at  timestamptz,
  clerk_updated_at          timestamptz not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- There is exactly one Owner, ever: the first verified sign-in matching OWNER_EMAIL.
create unique index accounts_single_owner on public.accounts ((true)) where role = 'owner';

create table public.profiles (
  account_id    uuid primary key references public.accounts (id) on delete cascade,
  display_name  text not null,
  image_url     text,
  updated_at    timestamptz not null default now()
);

-- No policies: the anon and authenticated roles can read or write nothing. Only the service role (the API) can.
alter table public.accounts enable row level security;
alter table public.profiles enable row level security;
revoke all on public.accounts, public.profiles from anon, authenticated;
