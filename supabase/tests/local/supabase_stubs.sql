-- Minimal stand-ins for the parts of a Supabase project that the migrations
-- rely on, so they can be tested against a plain PostgreSQL 15+ server.
-- Used only by scripts/test-db.sh – never run this against Supabase.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(p_secret text, p_name text, p_description text default '') returns uuid
language sql as $$ insert into vault.secrets (secret, name, description) values (p_secret, p_name, p_description) returning id $$;
create function vault.update_secret(p_id uuid, p_secret text) returns void
language sql as $$ update vault.secrets set secret = p_secret where id = p_id $$;
