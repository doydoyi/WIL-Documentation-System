-- =============================================================================
-- WIL Document Management and Automated Reporting System
-- Sprint 1 – initial schema (SDD §2, Figure 2 "Overall data model")
--
-- Contents
--   1. Enumerated types (SDD Table 3)
--   2. Tables (all entities of the data model)
--   3. Helper functions for role checks (used by RLS)
--   4. Triggers: updated_at, completeness check, last-Administrator guard,
--      append-only audit trail
--   5. Domain functions: atomic document code generation, registration,
--      sync-run locking, Google credential storage (Vault)
--   6. Row Level Security policies
--   7. Seed data: office category and purpose codes (FR-1.4.4)
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Enumerated types
-- -----------------------------------------------------------------------------
create type public.user_role     as enum ('administrator', 'records_staff', 'viewer');
create type public.sync_trigger  as enum ('scheduled', 'manual');
create type public.reg_status    as enum ('unclassified', 'registered', 'excluded', 'removed');
create type public.code_status   as enum ('provisional', 'confirmed');
create type public.record_status as enum ('complete', 'incomplete');
create type public.match_target  as enum ('file_name', 'folder_path', 'extracted_text');
create type public.field_source  as enum ('user_input', 'document_field', 'computed');

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------

-- Office personnel allowed to use the system (UC-1.1, UC-1.2).
-- The id is the Supabase Auth user id; Administrators pre-create the auth user
-- for an email address so that the first Google sign-in links to it.
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique check (email = lower(email)),
  full_name     text not null default '',
  role          public.user_role not null default 'viewer',
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

-- Reference codes (UC-1.4). Codes are never deleted, only deactivated.
create table public.categories (
  code        char(3) primary key check (code ~ '^[A-Z]{3}$'),
  name        text not null,
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.purposes (
  code        varchar(4) primary key check (code ~ '^[ABC][0-9]$'),
  name        text not null,
  description text not null default '',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Required fields per category (FR-1.4.3, FR-2.4.2).
create table public.required_field_rules (
  id            integer generated always as identity primary key,
  category_code char(3) not null references public.categories (code) on update cascade,
  field_name    text not null check (field_name in ('title', 'description', 'document_date')),
  is_required   boolean not null default true,
  unique (category_code, field_name)
);

-- Classification rules for automatic coding (FR-1.4.3, FR-2.2.2).
-- pattern is a case-insensitive regular expression; lower priority runs first.
create table public.classification_rules (
  id            integer generated always as identity primary key,
  pattern       text not null check (length(pattern) between 1 and 500),
  match_on      public.match_target not null default 'file_name',
  category_code char(3) not null references public.categories (code) on update cascade,
  purpose_code  varchar(4) not null references public.purposes (code) on update cascade,
  priority      integer not null default 100 check (priority between 0 and 10000),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- One counter per category, purpose and year (FR-2.2.3, FR-2.2.4).
create table public.sequence_counters (
  scope_key     text primary key,               -- e.g. 'EVT-A0-2026'
  category_code char(3) not null references public.categories (code) on update cascade,
  purpose_code  varchar(4) not null references public.purposes (code) on update cascade,
  doc_year      smallint not null check (doc_year between 1990 and 2999),
  last_value    integer not null default 0 check (last_value between 0 and 999),
  unique (category_code, purpose_code, doc_year)
);

-- Shared Drive connection – a single-row table (UC-1.5).
create table public.drive_config (
  id                      smallint primary key default 1 check (id = 1),
  shared_drive_id         text unique,
  shared_drive_name       text,
  excluded_folder_ids     text[] not null default '{}',
  start_page_token        text,
  poll_interval_minutes   integer not null default 15 check (poll_interval_minutes between 5 and 1440),
  last_synced_at          timestamptz,
  status                  text not null default 'not_connected'
                          check (status in ('not_connected', 'account_connected', 'configured', 'scanning', 'ready', 'error')),
  connected_account_email text,
  configured_by           uuid references public.profiles (id) on delete set null,
  updated_at              timestamptz not null default now()
);
insert into public.drive_config (id) values (1);

-- Each synchronization or scan run (FR-2.1.4).
create table public.sync_runs (
  id               bigint generated always as identity primary key,
  trigger          public.sync_trigger not null,
  mode             text not null default 'incremental' check (mode in ('initial', 'incremental')),
  triggered_by     uuid references public.profiles (id) on delete set null,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  files_added      integer not null default 0,
  files_updated    integer not null default 0,
  files_removed    integer not null default 0,
  files_registered integer not null default 0,
  files_queued     integer not null default 0,
  error_message    text
);
-- Only one run may execute at a time (FR-2.1.5).
create unique index sync_runs_one_running on public.sync_runs ((true)) where status = 'running';
create index sync_runs_started_at_idx on public.sync_runs (started_at desc);

-- Inventory of Shared Drive files (metadata only, FR-1.5.3).
create table public.drive_files (
  drive_file_id       text primary key,
  name                text not null,
  mime_type           text not null,
  folder_path         text not null default '/',
  parent_id           text,
  web_view_link       text,
  size_bytes          bigint,
  created_time        timestamptz not null,
  modified_time       timestamptz,
  is_trashed          boolean not null default false,
  registration_status public.reg_status not null default 'unclassified',
  last_sync_id        bigint references public.sync_runs (id) on delete set null,
  updated_at          timestamptz not null default now()
);
create index drive_files_registration_status_idx on public.drive_files (registration_status);

-- The masterlist (UC-2.2).
create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  document_code         text not null unique
                        check (document_code ~ '^[A-Z]{2,4}-[A-Z]{3}-[ABC][0-9]-[0-9]{4}-[0-9]{3}$'),
  drive_file_id         text not null unique references public.drive_files (drive_file_id),
  office_code           varchar(4) not null default 'WIL',
  category_code         char(3) not null references public.categories (code) on update cascade,
  purpose_code          varchar(4) not null references public.purposes (code) on update cascade,
  doc_year              smallint not null,
  sequence_no           integer not null check (sequence_no between 1 and 999),
  code_status           public.code_status not null default 'provisional',
  title                 text,
  description           text,
  document_date         date,
  record_status         public.record_status not null default 'complete',
  missing_fields        text[] not null default '{}',
  code_written_to_drive boolean not null default false,  -- FR-2.2.9 / UC-2.2 E2 retry flag
  registered_by         uuid references public.profiles (id) on delete set null,
  registered_at         timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index documents_category_purpose_idx on public.documents (category_code, purpose_code);
create index documents_code_status_idx on public.documents (code_status);
create index documents_record_status_idx on public.documents (record_status);
create index documents_code_prefix_idx on public.documents (document_code text_pattern_ops);

-- OCR results (UC-2.5, Sprint 2 feature; table created with the data model).
create table public.ocr_results (
  id             uuid primary key default gen_random_uuid(),
  drive_file_id  text not null references public.drive_files (drive_file_id),
  ocr_doc_id     text,
  extracted_text text,
  language       text not null default 'en',
  status         text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  requested_by   uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);

-- Report templates (UC-4.1, Sprint 2 feature).
create table public.report_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  report_type      text not null check (report_type in ('event_accomplishment', 'terminal_report', 'program_summary')),
  google_doc_id    text not null unique,
  output_folder_id text not null,
  category_code    char(3) not null references public.categories (code) on update cascade,
  purpose_code     varchar(4) not null references public.purposes (code) on update cascade,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now()
);

create table public.template_fields (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.report_templates (id) on delete cascade,
  placeholder text not null,
  label       text not null,
  source      public.field_source not null default 'user_input',
  data_type   text not null default 'text' check (data_type in ('text', 'long_text', 'date', 'number')),
  is_required boolean not null default true,
  unique (template_id, placeholder)
);

create table public.generated_reports (
  id                   uuid primary key default gen_random_uuid(),
  template_id          uuid not null references public.report_templates (id),
  document_id          uuid references public.documents (id),
  output_drive_file_id text,
  input_values         jsonb not null default '{}',
  status               text not null default 'draft' check (status in ('draft', 'generated', 'needs_registration', 'failed')),
  generated_by         uuid references public.profiles (id) on delete set null,
  generated_at         timestamptz not null default now()
);

-- Append-only audit trail (UC-1.3, NFR-SE-05).
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   text,
  old_values  jsonb,
  new_values  jsonb,
  created_at  timestamptz not null default now()
);
create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_action_idx on public.audit_logs (action);

-- -----------------------------------------------------------------------------
-- 3. Role helpers (SECURITY DEFINER so RLS policies can read profiles safely)
-- -----------------------------------------------------------------------------

-- Role of the signed-in user, or NULL if the user has no active profile.
create or replace function public.current_app_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active
$$;

create or replace function public.has_role(variadic roles public.user_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_app_role() = any (roles), false)
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_app_role() is not null
$$;

-- Actor for audit entries: the signed-in user, or the actor that a trusted
-- server process declared for the current transaction (app.actor_id).
create or replace function public.audit_actor()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_setting text;
begin
  if v_actor is null then
    v_setting := nullif(current_setting('app.actor_id', true), '');
    if v_setting is not null then
      v_actor := v_setting::uuid;
    end if;
  end if;
  if v_actor is not null and not exists (select 1 from public.profiles where id = v_actor) then
    return null;
  end if;
  return v_actor;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Triggers
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger documents_set_updated_at before update on public.documents
  for each row execute function public.set_updated_at();
create trigger drive_files_set_updated_at before update on public.drive_files
  for each row execute function public.set_updated_at();
create trigger drive_config_set_updated_at before update on public.drive_config
  for each row execute function public.set_updated_at();

-- Missing-information detection (FR-2.2.10, FR-2.3.3): recalculated on every
-- insert and update from the category's required-field rules.
create or replace function public.check_document_completeness()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(new);
  v_missing text[];
begin
  select coalesce(array_agg(r.field_name order by r.field_name), '{}')
    into v_missing
    from public.required_field_rules r
   where r.category_code = new.category_code
     and r.is_required
     and nullif(btrim(coalesce(v_row ->> r.field_name, '')), '') is null;

  new.missing_fields := v_missing;
  new.record_status := case when cardinality(v_missing) = 0 then 'complete' else 'incomplete' end;
  return new;
end;
$$;

create trigger documents_check_completeness before insert or update on public.documents
  for each row execute function public.check_document_completeness();

-- When required-field rules change, re-check the affected documents.
create or replace function public.recheck_category_completeness()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.documents d
     set missing_fields = d.missing_fields
   where d.category_code in (
     select x from unnest(array[
       case when tg_op <> 'INSERT' then old.category_code end,
       case when tg_op <> 'DELETE' then new.category_code end
     ]) as x where x is not null);
  return null;
end;
$$;

create trigger required_field_rules_recheck after insert or update or delete on public.required_field_rules
  for each row execute function public.recheck_category_completeness();

-- The last active Administrator can never be deactivated, demoted or removed
-- (FR-1.2.3).
create or replace function public.protect_last_administrator()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.role = 'administrator' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'administrator' or not new.is_active) then
    if not exists (
      select 1 from public.profiles p
       where p.id <> old.id and p.role = 'administrator' and p.is_active
    ) then
      raise exception 'The last active Administrator cannot be deactivated, demoted, or removed.'
        using errcode = 'P0001', hint = 'last_administrator';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger profiles_protect_last_admin before update or delete on public.profiles
  for each row execute function public.protect_last_administrator();

-- Profiles keep their e-mail address; it is tied to the Google account.
create or replace function public.prevent_profile_email_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.email <> old.email then
    raise exception 'A user''s e-mail address cannot be changed. Deactivate the profile and add a new one.'
      using errcode = 'P0001', hint = 'email_immutable';
  end if;
  return new;
end;
$$;

create trigger profiles_email_immutable before update on public.profiles
  for each row execute function public.prevent_profile_email_change();

-- Generic audit trigger: writes old and new values of every change
-- (FR-1.2.4, FR-1.3.2). TG_ARGV[0] names the primary-key column.
-- Updates that only touch derived columns are not logged.
create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_pk text := coalesce(tg_argv[0], 'id');
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  -- Derived or bookkeeping columns; sign-ins are logged as their own event.
  v_ignored text[] := array['updated_at', 'missing_fields', 'record_status', 'last_sync_id', 'last_login_at',
                            'code_written_to_drive'];
begin
  if tg_op = 'UPDATE' and (v_old - v_ignored) = (v_new - v_ignored) then
    return null;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values)
  values (
    public.audit_actor(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_new ->> v_pk, v_old ->> v_pk),
    v_old,
    v_new
  );
  return null;
end;
$$;

create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change('id');
create trigger audit_categories after insert or update or delete on public.categories
  for each row execute function public.audit_row_change('code');
create trigger audit_purposes after insert or update or delete on public.purposes
  for each row execute function public.audit_row_change('code');
create trigger audit_required_field_rules after insert or update or delete on public.required_field_rules
  for each row execute function public.audit_row_change('id');
create trigger audit_classification_rules after insert or update or delete on public.classification_rules
  for each row execute function public.audit_row_change('id');
create trigger audit_drive_config after insert or update or delete on public.drive_config
  for each row execute function public.audit_row_change('id');
create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function public.audit_row_change('id');
create trigger audit_report_templates after insert or update or delete on public.report_templates
  for each row execute function public.audit_row_change('id');

-- Audit entries are append-only for every role, including the service role
-- (FR-1.3.3, NFR-SE-05).
create or replace function public.prevent_audit_modification()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception 'Audit entries are append-only and cannot be changed or deleted.'
    using errcode = 'P0001', hint = 'audit_append_only';
end;
$$;

create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_modification();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.prevent_audit_modification();

-- -----------------------------------------------------------------------------
-- 5. Domain functions
-- -----------------------------------------------------------------------------

-- Atomic document code generation (FR-2.2.3, FR-2.2.4, NFR-RE-03).
-- INSERT ... ON CONFLICT DO UPDATE takes a row lock on the counter, so
-- concurrent callers for the same scope are serialized and each receives a
-- different number. Numbers are never decremented, so retired codes are never
-- reused (FR-2.2.6).
create or replace function public.generate_document_code(
  p_category char(3),
  p_purpose  varchar(4),
  p_year     smallint,
  p_office   varchar(4) default 'WIL'
)
returns table (document_code text, sequence_no integer)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_scope text := p_category || '-' || p_purpose || '-' || p_year::text;
  v_next  integer;
begin
  if not exists (select 1 from public.categories c where c.code = p_category and c.is_active) then
    raise exception 'Category % does not exist or is inactive.', p_category using errcode = 'P0001', hint = 'invalid_category';
  end if;
  if not exists (select 1 from public.purposes p where p.code = p_purpose and p.is_active) then
    raise exception 'Purpose % does not exist or is inactive.', p_purpose using errcode = 'P0001', hint = 'invalid_purpose';
  end if;

  insert into public.sequence_counters as sc (scope_key, category_code, purpose_code, doc_year, last_value)
  values (v_scope, p_category, p_purpose, p_year, 1)
  on conflict (scope_key) do update set last_value = sc.last_value + 1
    where sc.last_value < 999
  returning sc.last_value into v_next;

  if v_next is null then
    raise exception 'Sequence for % is full (999 documents per category, purpose and year).', v_scope
      using errcode = 'P0001', hint = 'sequence_exhausted';
  end if;

  document_code := p_office || '-' || p_category || '-' || p_purpose || '-' || p_year::text || '-' || lpad(v_next::text, 3, '0');
  sequence_no := v_next;
  return next;
end;
$$;

-- Register a Shared Drive file and assign its code in one transaction
-- (UC-2.2 steps 4–6). Called by the server for automatic registration with
-- p_actor set; signed-in Records Staff and Administrators may also call it.
create or replace function public.register_document(
  p_drive_file_id text,
  p_category      char(3),
  p_purpose       varchar(4),
  p_code_status   public.code_status default 'provisional',
  p_actor         uuid default null,
  p_title         text default null,
  p_description   text default null,
  p_document_date date default null,
  p_office        varchar(4) default 'WIL'
)
returns public.documents
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_file public.drive_files;
  v_code record;
  v_doc  public.documents;
  v_year smallint;
begin
  if auth.uid() is not null then
    if not public.has_role('administrator', 'records_staff') then
      raise exception 'Only Records Staff and Administrators can register documents.'
        using errcode = '42501';
    end if;
  elsif p_actor is not null then
    perform set_config('app.actor_id', p_actor::text, true);
  end if;

  select * into v_file from public.drive_files where drive_file_id = p_drive_file_id for update;
  if not found then
    raise exception 'Drive file % is not in the inventory.', p_drive_file_id using errcode = 'P0001', hint = 'file_not_found';
  end if;
  if v_file.registration_status = 'excluded' then
    raise exception 'Files in excluded folders are never registered.' using errcode = 'P0001', hint = 'file_excluded';
  end if;
  if v_file.registration_status = 'registered'
     or exists (select 1 from public.documents d where d.drive_file_id = p_drive_file_id) then
    raise exception 'Drive file % is already registered.', p_drive_file_id using errcode = 'P0001', hint = 'already_registered';
  end if;

  -- YEAR is the year the file was created in the Shared Drive (office time).
  v_year := extract(year from (v_file.created_time at time zone 'Asia/Manila'))::smallint;

  select * into v_code from public.generate_document_code(p_category, p_purpose, v_year, p_office);

  insert into public.documents (
    document_code, drive_file_id, office_code, category_code, purpose_code, doc_year,
    sequence_no, code_status, title, description, document_date, registered_by
  ) values (
    v_code.document_code, p_drive_file_id, p_office, p_category, p_purpose, v_year,
    v_code.sequence_no, p_code_status,
    coalesce(nullif(btrim(p_title), ''), regexp_replace(v_file.name, '\.[A-Za-z0-9]{1,5}$', '')),
    nullif(btrim(p_description), ''), p_document_date,
    coalesce(auth.uid(), p_actor)
  )
  returning * into v_doc;

  update public.drive_files set registration_status = 'registered' where drive_file_id = p_drive_file_id;
  return v_doc;
end;
$$;

-- Start a sync or scan run; fails if one is already running (FR-2.1.5).
-- Runs stuck for more than an hour are marked failed first.
create or replace function public.start_sync_run(
  p_trigger public.sync_trigger,
  p_mode    text,
  p_actor   uuid default null
)
returns bigint
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id bigint;
begin
  update public.sync_runs
     set status = 'failed', finished_at = now(), error_message = 'Run timed out and was abandoned.'
   where status = 'running' and started_at < now() - interval '1 hour';

  begin
    insert into public.sync_runs (trigger, mode, triggered_by)
    values (p_trigger, p_mode, p_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'A synchronization is already running. Wait for it to finish.'
      using errcode = 'P0001', hint = 'sync_in_progress';
  end;
  return v_id;
end;
$$;

-- Google refresh token storage in Supabase Vault (FR-1.5.5, NFR-SE-03).
-- Only the service role may call these functions.
create or replace function public.set_google_refresh_token(p_token text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'google_drive_refresh_token';
  if v_id is null then
    perform vault.create_secret(p_token, 'google_drive_refresh_token', 'Refresh token of the authorizing Administrator');
  else
    perform vault.update_secret(v_id, p_token);
  end if;
end;
$$;

create or replace function public.get_google_refresh_token()
returns text
language sql stable security definer set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'google_drive_refresh_token' limit 1
$$;

-- Lock down function execution. Supabase grants EXECUTE to anon and
-- authenticated by default; revoke and grant only what each role needs.
revoke execute on function public.generate_document_code(char, varchar, smallint, varchar) from public, anon, authenticated;
revoke execute on function public.register_document(text, char, varchar, public.code_status, uuid, text, text, date, varchar) from public, anon;
revoke execute on function public.start_sync_run(public.sync_trigger, text, uuid) from public, anon, authenticated;
revoke execute on function public.set_google_refresh_token(text) from public, anon, authenticated;
revoke execute on function public.get_google_refresh_token() from public, anon, authenticated;
revoke execute on function public.audit_actor() from public, anon, authenticated;
grant execute on function public.register_document(text, char, varchar, public.code_status, uuid, text, text, date, varchar) to authenticated, service_role;
grant execute on function public.generate_document_code(char, varchar, smallint, varchar) to service_role;
grant execute on function public.start_sync_run(public.sync_trigger, text, uuid) to service_role;
grant execute on function public.set_google_refresh_token(text) to service_role;
grant execute on function public.get_google_refresh_token() to service_role;

-- -----------------------------------------------------------------------------
-- 6. Row Level Security (NFR-SE-02)
-- -----------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.categories           enable row level security;
alter table public.purposes             enable row level security;
alter table public.required_field_rules enable row level security;
alter table public.classification_rules enable row level security;
alter table public.sequence_counters    enable row level security;
alter table public.drive_config         enable row level security;
alter table public.sync_runs            enable row level security;
alter table public.drive_files          enable row level security;
alter table public.documents            enable row level security;
alter table public.ocr_results          enable row level security;
alter table public.report_templates     enable row level security;
alter table public.template_fields      enable row level security;
alter table public.generated_reports    enable row level security;
alter table public.audit_logs           enable row level security;

-- profiles: any active user may read (names appear on records);
-- only Administrators may add or edit (FR-1.2.1). Users may always read their
-- own row so the application can explain an inactive account.
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_user() or id = auth.uid());
create policy profiles_admin_insert on public.profiles for insert to authenticated
  with check (public.has_role('administrator'));
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));

-- Reference data: readable by active users, writable by Administrators.
-- Codes have no delete policy: they are deactivated instead (FR-1.4.2).
create policy categories_select on public.categories for select to authenticated using (public.is_active_user());
create policy categories_admin_insert on public.categories for insert to authenticated with check (public.has_role('administrator'));
create policy categories_admin_update on public.categories for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));

create policy purposes_select on public.purposes for select to authenticated using (public.is_active_user());
create policy purposes_admin_insert on public.purposes for insert to authenticated with check (public.has_role('administrator'));
create policy purposes_admin_update on public.purposes for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));

create policy required_fields_select on public.required_field_rules for select to authenticated using (public.is_active_user());
create policy required_fields_admin_insert on public.required_field_rules for insert to authenticated with check (public.has_role('administrator'));
create policy required_fields_admin_update on public.required_field_rules for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));
create policy required_fields_admin_delete on public.required_field_rules for delete to authenticated using (public.has_role('administrator'));

create policy rules_select on public.classification_rules for select to authenticated using (public.is_active_user());
create policy rules_admin_insert on public.classification_rules for insert to authenticated with check (public.has_role('administrator'));
create policy rules_admin_update on public.classification_rules for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));
create policy rules_admin_delete on public.classification_rules for delete to authenticated using (public.has_role('administrator'));

-- sequence_counters: no policies; only reachable through generate_document_code.

-- Drive configuration: Administrators manage it; Records Staff can see status.
create policy drive_config_select on public.drive_config for select to authenticated
  using (public.has_role('administrator', 'records_staff'));
create policy drive_config_admin_update on public.drive_config for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));

create policy sync_runs_select on public.sync_runs for select to authenticated
  using (public.has_role('administrator', 'records_staff'));

create policy drive_files_select on public.drive_files for select to authenticated
  using (public.has_role('administrator', 'records_staff'));

-- Masterlist: every active user may read; Records Staff and Administrators
-- may edit. No delete policy – removed files are flagged, never deleted.
create policy documents_select on public.documents for select to authenticated using (public.is_active_user());
create policy documents_staff_update on public.documents for update to authenticated
  using (public.has_role('administrator', 'records_staff'))
  with check (public.has_role('administrator', 'records_staff'));

create policy ocr_results_select on public.ocr_results for select to authenticated
  using (public.has_role('administrator', 'records_staff'));

create policy report_templates_select on public.report_templates for select to authenticated
  using (public.has_role('administrator', 'records_staff'));
create policy report_templates_admin_insert on public.report_templates for insert to authenticated with check (public.has_role('administrator'));
create policy report_templates_admin_update on public.report_templates for update to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));

create policy template_fields_select on public.template_fields for select to authenticated
  using (public.has_role('administrator', 'records_staff'));
create policy template_fields_admin_all on public.template_fields for all to authenticated
  using (public.has_role('administrator')) with check (public.has_role('administrator'));

create policy generated_reports_select on public.generated_reports for select to authenticated using (public.is_active_user());

-- Audit logs: Administrators read; nobody writes through the API.
create policy audit_logs_admin_select on public.audit_logs for select to authenticated
  using (public.has_role('administrator'));

-- -----------------------------------------------------------------------------
-- 7. Seed data (FR-1.4.4) – the office's 8 category and 13 purpose codes
-- -----------------------------------------------------------------------------
insert into public.categories (code, name) values
  ('EVT', 'Events and Program Reports'),
  ('SUB', 'Student Works and Student Submissions'),
  ('EVL', 'Evaluations, Rubrics, and Grading System'),
  ('ADM', 'Administrative and Policy Documents'),
  ('ARC', 'Attendance, Registration, and Classlists'),
  ('MED', 'Media, Promotional Assets, and Pubmats'),
  ('FIN', 'Financial and Liquidation Documents'),
  ('TPL', 'Standard Templates');

insert into public.purposes (code, name, description) values
  ('A0', 'Internal – TEC',                             'Internal purposes'),
  ('A1', 'Internal – TBI basics',                      'Internal purposes'),
  ('A2', 'Internal – SpotLab',                         'Internal purposes'),
  ('A3', 'Internal – LaunchLab',                       'Internal purposes'),
  ('A4', 'Internal – Others',                          'Internal purposes'),
  ('B1', 'University – Executive Offices',             'University purposes'),
  ('B2', 'University – FAO',                           'University purposes'),
  ('B3', 'University – Research Council/Innovation Group', 'University purposes'),
  ('B4', 'University – Nexus',                         'University purposes'),
  ('B5', 'University – Others',                        'University purposes'),
  ('C1', 'External – Government',                      'External purposes'),
  ('C2', 'External – Industry Partner',                'External purposes'),
  ('C3', 'External – Others',                          'External purposes');

-- Baseline: every category requires a title. The office confirms further
-- required fields during requirements validation (SRS §2.5).
insert into public.required_field_rules (category_code, field_name)
select code, 'title' from public.categories;
