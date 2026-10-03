-- ASCENTRA L1: paste this whole file into the Supabase SQL Editor and click Run, once.
-- Requires 0011_notices_and_privacy (already applied). Applies: 0012_source_library.
-- Runs in one transaction: if anything fails, nothing is changed.
-- Generated from db/migrations by scripts/bundle-migrations.mjs. Do not edit by hand.

begin;

-- ============================================================
-- 0012_source_library.sql
-- ============================================================

-- L1: the source library, citations and conflicts, and the AI call log.
--   sources (F3) becomes a ledger: link or file, license class (open, owner_supplied, web_summarize_only), who
--   added it, who approved it and when, last_checked_at, and status (proposed, approved, rejected, stale). Library
--   sources have no academy; F3's academy-scoped sample sources keep working as before.
--   source_chunks: the text split for search, with a pgvector embedding and a full-text index. For a
--   web_summarize_only source only a short quote (300 characters at most) is kept per chunk: the full text is used
--   to build the search index and is not stored.
--   source_claims: each keeps its citation (source, chunk, short quoted text), or is marked 'no_source'.
--   source_conflicts / authority_decisions: two approved library sources disagree → a conflict; a Reviewer (or the
--   Owner) records which source is followed and why. Decisions are versioned and insert-only.
--   open_license_sources: the Owner's list of open-licensed sources to add from.
--   ai_calls: one row per model or embedding call: purpose, model, tokens, cost. Never prompts or learner content.
-- Nothing here calls anything attorney-approved: decisions and claims that say so are refused.
-- Safe with the B4 code: nothing before L1 reads or writes these columns or tables.

do $$
declare applied boolean := false;
begin
  if to_regclass('private.schema_migrations') is not null then
    execute 'select exists (select 1 from private.schema_migrations where version = ''0011_notices_and_privacy'')' into applied;
  end if;
  if not applied then
    raise exception 'ASCENTRA: apply B4 (0011) first. Nothing was changed.';
  end if;
end $$;

select private.begin_migration('0012_source_library');

-- pgvector, in Supabase's extensions schema (already there on Supabase).
create schema if not exists extensions;
create extension if not exists vector with schema extensions;

-- ============ Sources: the ledger ============

alter table public.sources
  alter column academy_id drop not null,
  add column kind text not null default 'url' check (kind in ('url', 'document', 'open_list')),
  add column license_class text not null default 'web_summarize_only'
    check (license_class in ('open', 'owner_supplied', 'web_summarize_only')),
  add column license_name text,
  add column status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'stale')),
  add column found_at timestamptz not null default now(),
  add column added_by_account_id uuid references public.accounts (id),
  add column approved_by_account_id uuid references public.accounts (id),
  add column approved_at timestamptz,
  add column last_checked_at timestamptz,
  add column storage_path text,
  add column mime_type text,
  add column content_sha256 text,
  add column chunk_count integer not null default 0,
  -- A library source (no academy) is a link or a stored file.
  add constraint sources_link_or_file check (academy_id is not null or url is not null or storage_path is not null),
  add constraint sources_approved_by check (status <> 'approved' or (approved_by_account_id is not null and approved_at is not null));

create unique index sources_library_url on public.sources (lower(url)) where academy_id is null and url is not null;
create unique index sources_library_file on public.sources (content_sha256) where academy_id is null and content_sha256 is not null;
create index sources_library_status on public.sources (status, license_class) where academy_id is null;

-- An owner_supplied source is approved by the Owner; the others by a Reviewer or the Owner (the API checks the
-- capability; this makes the Owner-only rule hold for any writer).
create function private.source_approval_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved' or old.approved_by_account_id is distinct from new.approved_by_account_id) then
    if new.license_class = 'owner_supplied'
       and not exists (select 1 from public.accounts a where a.id = new.approved_by_account_id and a.role = 'owner') then
      raise exception 'ASCENTRA: an owner-supplied source is approved by the Owner.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.accounts a where a.id = new.approved_by_account_id and a.role in ('owner', 'admin') and a.status = 'active') then
      raise exception 'ASCENTRA: only the Owner or a Reviewer approves a source.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.source_approval_rules() from public;
create trigger source_approval_rules before insert or update on public.sources
  for each row execute function private.source_approval_rules();

-- ============ Chunks ============

create table public.source_chunks (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references public.sources (id) on delete cascade,
  position         integer not null check (position >= 0),
  content          text not null check (char_length(content) <= 4000),
  -- true for web_summarize_only: content is a short quote, not the source's text.
  is_excerpt       boolean not null default false,
  token_estimate   integer not null default 0,
  embedding        extensions.vector(1024),
  search           tsvector not null,
  retention_class  public.retention_class not null default 'content',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (source_id, position),
  check (not is_excerpt or char_length(content) <= 300)
);
create index source_chunks_search on public.source_chunks using gin (search);
create index source_chunks_embedding on public.source_chunks using hnsw (embedding extensions.vector_cosine_ops);

-- Replaces a source's chunks. Each item: { position, text, quote?, tokens?, embedding? (1024 numbers) }.
-- A web_summarize_only source keeps only the quote (or the first 300 characters); the text feeds the index only.
create function public.put_source_chunks(p_source uuid, p_chunks jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.sources;
  c jsonb;
  n integer := 0;
begin
  select * into s from public.sources where id = p_source for update;
  if s.id is null then raise exception 'ASCENTRA: no such source.' using errcode = 'no_data_found'; end if;
  delete from public.source_chunks where source_id = p_source;
  for c in select * from jsonb_array_elements(p_chunks) loop
    insert into public.source_chunks (source_id, position, content, is_excerpt, token_estimate, embedding, search)
    values (
      p_source, (c ->> 'position')::integer,
      case when s.license_class = 'web_summarize_only' then left(coalesce(nullif(c ->> 'quote', ''), c ->> 'text'), 300) else c ->> 'text' end,
      s.license_class = 'web_summarize_only',
      coalesce((c ->> 'tokens')::integer, 0),
      case when jsonb_typeof(c -> 'embedding') = 'array' then (c ->> 'embedding')::extensions.vector end,
      to_tsvector('english', c ->> 'text')
    );
    n := n + 1;
  end loop;
  update public.sources set chunk_count = n, updated_at = now() where id = p_source;
  return n;
end $$;
revoke all on function public.put_source_chunks(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.put_source_chunks(uuid, jsonb) to service_role;

-- Retrieval: the best chunks of approved library sources for a query, by embedding when one is given, otherwise
-- by full-text rank. Each row carries its source and license, so every result keeps its citation.
create function public.match_source_chunks(p_query text, p_embedding text, p_limit integer)
returns table (chunk_id uuid, source_id uuid, title text, url text, license_class text, license_name text,
               content text, is_excerpt boolean, score double precision)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq,
                    case when p_embedding is null then null else p_embedding::extensions.vector end as emb)
  select c.id, s.id, s.title, s.url, s.license_class, s.license_name, c.content, c.is_excerpt,
         case when q.emb is not null and c.embedding is not null
              then 1 - (c.embedding operator(extensions.<=>) q.emb)
              else ts_rank(c.search, q.tsq)::double precision end as score
  from public.source_chunks c
  join public.sources s on s.id = c.source_id
  cross join q
  where s.academy_id is null and s.status = 'approved'
    and ((q.emb is not null and c.embedding is not null) or c.search @@ q.tsq)
  order by score desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;
revoke all on function public.match_source_chunks(text, text, integer) from public, anon, authenticated;
grant execute on function public.match_source_chunks(text, text, integer) to service_role;

-- ============ Claims: each keeps its citation, or is marked as having none ============

alter table public.source_claims
  alter column source_id drop not null,
  add column chunk_id uuid references public.source_chunks (id) on delete set null,
  add column cited_text text check (char_length(cited_text) <= 400),
  add column citation_status text not null default 'cited' check (citation_status in ('cited', 'no_source')),
  add column extracted_by text not null default 'person' check (extracted_by in ('person', 'ai')),
  add column added_by_account_id uuid references public.accounts (id),
  add constraint source_claims_citation check ((citation_status = 'no_source') = (source_id is null)),
  add constraint source_claims_not_attorney check (claim !~* 'attorney[- ]?approved|lawyer[- ]?approved');

create function private.claim_cites_approved_source() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A lesson cites only an approved library source (F3's academy-scoped sample sources aren't in the library).
  if new.lesson_id is not null and new.source_id is not null
     and exists (select 1 from public.sources s where s.id = new.source_id and s.academy_id is null and s.status <> 'approved') then
    raise exception 'ASCENTRA: a lesson can only cite an approved source.' using errcode = 'check_violation';
  end if;
  if new.chunk_id is not null and not exists (select 1 from public.source_chunks c where c.id = new.chunk_id and c.source_id = new.source_id) then
    raise exception 'ASCENTRA: the cited passage isn''t from the cited source.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function private.claim_cites_approved_source() from public;
create trigger claim_cites_approved_source before insert or update on public.source_claims
  for each row execute function private.claim_cites_approved_source();

-- ============ Conflicts and authority decisions ============

alter table public.source_conflicts
  alter column academy_id drop not null,
  add column detected_by text not null default 'person' check (detected_by in ('person', 'ai')),
  add column created_by_account_id uuid references public.accounts (id);

-- One open conflict per pair of claims, whichever way round.
create unique index source_conflicts_one_open_pair on public.source_conflicts
  (least(claim_a_id, claim_b_id), greatest(claim_a_id, claim_b_id)) where status = 'open';

create function private.library_conflict_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.academy_id is null and tg_op = 'INSERT' then
    -- A library conflict is between claims of two different approved sources.
    if not exists (
      select 1 from public.source_claims a join public.sources sa on sa.id = a.source_id,
                    public.source_claims b join public.sources sb on sb.id = b.source_id
      where a.id = new.claim_a_id and b.id = new.claim_b_id
        and sa.status = 'approved' and sb.status = 'approved' and sa.id <> sb.id
    ) then
      raise exception 'ASCENTRA: a source conflict is between claims of two different approved sources.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.library_conflict_rules() from public;
create trigger library_conflict_rules before insert on public.source_conflicts
  for each row execute function private.library_conflict_rules();

alter table public.authority_decisions
  add constraint authority_decisions_not_attorney
    check (decision !~* 'attorney[- ]?approved|lawyer[- ]?approved' and rationale !~* 'attorney[- ]?approved|lawyer[- ]?approved');

-- The followed claim is one of the two; recording a decision resolves the conflict. Insert-only (versioned).
create function private.authority_decision_rules() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.chosen_claim_id is not null and not exists (
    select 1 from public.source_conflicts c where c.id = new.source_conflict_id and new.chosen_claim_id in (c.claim_a_id, c.claim_b_id)
  ) then
    raise exception 'ASCENTRA: the followed claim must be one of the two in the conflict.' using errcode = 'check_violation';
  end if;
  update public.source_conflicts set status = 'resolved', updated_at = now() where id = new.source_conflict_id;
  return new;
end $$;
revoke all on function private.authority_decision_rules() from public;
create trigger authority_decision_rules before insert on public.authority_decisions
  for each row execute function private.authority_decision_rules();
create trigger reject_update_delete before update or delete on public.authority_decisions
  for each row execute function private.reject_change();

-- ============ The Owner's open-license list ============

create table public.open_license_sources (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  url                  text not null,
  license_name         text not null,     -- e.g. 'CC BY 4.0', 'Public domain (US government work)'
  notes                text,
  added_by_account_id  uuid references public.accounts (id),
  retention_class      public.retention_class not null default 'content',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index open_license_sources_url on public.open_license_sources (lower(url));

-- ============ AI calls (no prompts, no learner content) ============

create table public.ai_calls (
  id                  uuid primary key default gen_random_uuid(),
  purpose             text not null,
  provider            text not null check (provider in ('anthropic', 'voyage')),
  model               text not null,
  status              text not null check (status in ('ok', 'error', 'refused_cap', 'refused_off')),
  input_tokens        integer not null default 0,
  output_tokens       integer not null default 0,
  cache_read_tokens   integer not null default 0,
  cache_write_tokens  integer not null default 0,
  cost_usd            numeric(12, 6) not null default 0 check (cost_usd >= 0),
  duration_ms         integer,
  error_code          text,
  account_id          uuid references public.accounts (id),
  request_id          text,
  retention_class     public.retention_class not null default 'operational',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index ai_calls_created on public.ai_calls (created_at);

-- ============ Storage: a private bucket for uploaded documents (Supabase only) ============

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('source-documents', 'source-documents', false, 4194304, array['application/pdf', 'text/plain', 'text/markdown'])
    on conflict (id) do nothing;
  end if;
end $$;

-- ============ Same rules as every other table ============

do $$
declare t text;
begin
  foreach t in array array['source_chunks', 'open_license_sources', 'ai_calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function private.set_updated_at()', t);
  end loop;
end $$;

create index on public.sources (added_by_account_id);
create index on public.sources (approved_by_account_id);
create index on public.source_claims (chunk_id);
create index on public.source_claims (added_by_account_id);
create index on public.source_conflicts (created_by_account_id);
create index on public.open_license_sources (added_by_account_id);
create index on public.ai_calls (account_id);

commit;
