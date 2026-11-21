-- Behavioural tests for the Sprint 1 schema. Each block raises an exception
-- on failure; scripts/test-db.sh runs the file with ON_ERROR_STOP.
\set ON_ERROR_STOP on
set client_min_messages = warning;

-- Fixtures -------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@cit.edu'),
  ('00000000-0000-0000-0000-00000000000b', 'staff@cit.edu'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@cit.edu');
insert into public.profiles (id, email, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@cit.edu', 'Admin', 'administrator'),
  ('00000000-0000-0000-0000-00000000000b', 'staff@cit.edu', 'Staff', 'records_staff'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@cit.edu', 'Viewer', 'viewer');

insert into public.drive_files (drive_file_id, name, mime_type, folder_path, created_time) values
  ('f1', 'Hackathon Report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '/Events', '2026-03-01T10:00:00+08:00'),
  ('f2', 'Second.pdf', 'application/pdf', '/Events', '2026-03-02T10:00:00+08:00'),
  ('f3', 'NewYear.pdf', 'application/pdf', '/Events', '2025-12-31T23:30:00+08:00'),
  ('f4', 'Temp.pdf', 'application/pdf', '/_system', '2026-01-01T00:00:00+08:00');
update public.drive_files set registration_status = 'excluded' where drive_file_id = 'f4';

-- FR-1.4.4: seed data -----------------------------------------------------------
do $$ begin
  assert (select count(*) from public.categories) = 8, 'expected 8 categories';
  assert (select count(*) from public.purposes) = 13, 'expected 13 purposes';
end $$;

-- FR-2.2.3: code format, per-scope sequence, creation year in office time -----
do $$
declare d public.documents;
begin
  d := public.register_document('f1', 'EVT', 'A0', 'provisional', '00000000-0000-0000-0000-00000000000b');
  assert d.document_code = 'WIL-EVT-A0-2026-001', 'first code was ' || d.document_code;
  assert d.title = 'Hackathon Report', 'title from file name, got ' || coalesce(d.title, 'null');
  assert d.code_status = 'provisional';
  assert d.registered_by = '00000000-0000-0000-0000-00000000000b';
  d := public.register_document('f2', 'EVT', 'A0');
  assert d.document_code = 'WIL-EVT-A0-2026-002', 'second code was ' || d.document_code;
  d := public.register_document('f3', 'EVT', 'A0');
  assert d.document_code = 'WIL-EVT-A0-2025-001', 'year must restart numbering, got ' || d.document_code;
  assert (select registration_status from public.drive_files where drive_file_id = 'f1') = 'registered';
end $$;

-- Registration records the actor in the audit log -----------------------------
do $$ begin
  assert exists (
    select 1 from public.audit_logs
     where entity_type = 'documents' and action = 'insert'
       and actor_id = '00000000-0000-0000-0000-00000000000b'
       and new_values ->> 'document_code' = 'WIL-EVT-A0-2026-001'), 'registration audit entry missing';
end $$;

-- Already registered and excluded files are rejected (NFR-RE-07) -------------
do $$ begin
  begin perform public.register_document('f1', 'EVT', 'A0'); raise exception 'expected already_registered';
  exception when others then assert sqlerrm like '%already registered%', sqlerrm; end;
  begin perform public.register_document('f4', 'EVT', 'A0'); raise exception 'expected file_excluded';
  exception when others then assert sqlerrm like '%excluded%', sqlerrm; end;
end $$;

-- Inactive codes are not offered for new registrations (UC-1.4 A1) ---------
do $$ begin
  update public.purposes set is_active = false where code = 'C3';
  begin perform public.generate_document_code('EVT', 'C3', 2026::smallint); raise exception 'expected invalid_purpose';
  exception when others then assert sqlerrm like '%inactive%', sqlerrm; end;
  update public.purposes set is_active = true where code = 'C3';
end $$;

-- Sequence cap of 999 -----------------------------------------------------------
do $$ begin
  insert into public.sequence_counters values ('ADM-B1-2026', 'ADM', 'B1', 2026, 999);
  begin perform public.generate_document_code('ADM', 'B1', 2026::smallint); raise exception 'expected sequence_exhausted';
  exception when others then assert sqlerrm like '%full%', sqlerrm; end;
end $$;

-- FR-2.2.10: completeness recalculated when rules and records change --------
do $$
declare v public.documents;
begin
  insert into public.required_field_rules (category_code, field_name) values ('EVT', 'document_date');
  select * into v from public.documents where drive_file_id = 'f1';
  assert v.record_status = 'incomplete', 'expected incomplete after new rule';
  assert v.missing_fields = array['document_date'], 'missing ' || v.missing_fields::text;
  update public.documents set document_date = '2026-03-01' where drive_file_id = 'f1';
  select * into v from public.documents where drive_file_id = 'f1';
  assert v.record_status = 'complete', 'expected complete after edit';
end $$;

-- FR-1.2.3: last active Administrator is protected --------------------------
do $$ begin
  begin update public.profiles set role = 'viewer' where email = 'admin@cit.edu'; raise exception 'expected last_administrator';
  exception when others then assert sqlerrm like '%last active Administrator%', sqlerrm; end;
  begin update public.profiles set is_active = false where email = 'admin@cit.edu'; raise exception 'expected last_administrator';
  exception when others then assert sqlerrm like '%last active Administrator%', sqlerrm; end;
  -- With a second administrator the change is allowed.
  update public.profiles set role = 'administrator' where email = 'staff@cit.edu';
  update public.profiles set is_active = false where email = 'admin@cit.edu';
  update public.profiles set is_active = true where email = 'admin@cit.edu';
  update public.profiles set role = 'records_staff' where email = 'staff@cit.edu';
end $$;

-- FR-1.3.3: audit entries are append-only, even for the table owner ----------
do $$ begin
  begin update public.audit_logs set action = 'x'; raise exception 'expected append-only';
  exception when others then assert sqlerrm like '%append-only%', sqlerrm; end;
  begin delete from public.audit_logs; raise exception 'expected append-only';
  exception when others then assert sqlerrm like '%append-only%', sqlerrm; end;
  -- Profile changes carry old and new values (FR-1.2.4).
  assert exists (select 1 from public.audit_logs where entity_type = 'profiles' and action = 'update'
                  and old_values ->> 'role' = 'records_staff' and new_values ->> 'role' = 'administrator');
end $$;

-- FR-2.1.5: only one sync run at a time ---------------------------------------
do $$
declare v bigint;
begin
  v := public.start_sync_run('manual', 'initial', null);
  begin perform public.start_sync_run('manual', 'incremental', null); raise exception 'expected sync_in_progress';
  exception when others then assert sqlerrm like '%already running%', sqlerrm; end;
  update public.sync_runs set status = 'succeeded', finished_at = now() where id = v;
  perform public.start_sync_run('scheduled', 'incremental', null);
end $$;

-- Vault helpers -------------------------------------------------------------------
do $$ begin
  perform public.set_google_refresh_token('one');
  perform public.set_google_refresh_token('two');
  assert public.get_google_refresh_token() = 'two';
end $$;

-- Row Level Security (NFR-SE-02) ------------------------------------------------
set role authenticated;

-- Viewer: can read the masterlist, cannot read audit logs, cannot edit.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$
declare n int;
begin
  assert (select count(*) from public.documents) = 3, 'viewer should see documents';
  assert (select count(*) from public.audit_logs) = 0, 'viewer must not see audit logs';
  assert (select count(*) from public.drive_files) = 0, 'viewer must not see drive inventory';
  update public.documents set title = 'hack' where drive_file_id = 'f1';
  get diagnostics n = row_count;
  assert n = 0, 'viewer must not update documents';
  begin insert into public.categories (code, name) values ('ZZZ', 'x'); raise exception 'viewer inserted a category';
  exception when insufficient_privilege then null; end;
  begin perform public.register_document('f4', 'EVT', 'A0'); raise exception 'viewer registered a document';
  exception when insufficient_privilege then null; end;
  begin perform public.get_google_refresh_token(); raise exception 'viewer read the refresh token';
  exception when insufficient_privilege then null; end;
  begin perform public.generate_document_code('EVT', 'A0', 2026::smallint); raise exception 'viewer generated a code';
  exception when insufficient_privilege then null; end;
end $$;

-- Records Staff: can update documents, cannot manage users or reference codes.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare n int;
begin
  update public.documents set description = 'desc' where drive_file_id = 'f1';
  get diagnostics n = row_count;
  assert n = 1, 'staff should update documents';
  update public.profiles set role = 'administrator' where email = 'staff@cit.edu';
  get diagnostics n = row_count;
  assert n = 0, 'staff must not change roles';
  assert (select count(*) from public.audit_logs) = 0, 'staff must not see audit logs';
end $$;

-- Administrator: manages users and codes, reads audit logs, cannot delete codes.
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $$
declare n int;
begin
  insert into public.categories (code, name) values ('RES', 'Research');
  update public.profiles set full_name = 'Records Staff' where email = 'staff@cit.edu';
  get diagnostics n = row_count;
  assert n = 1, 'admin should edit profiles';
  assert (select count(*) from public.audit_logs) > 0, 'admin should read audit logs';
  delete from public.categories where code = 'RES';
  get diagnostics n = row_count;
  assert n = 0, 'codes must never be deleted';
  assert exists (select 1 from public.audit_logs where entity_type = 'categories' and entity_id = 'RES'
                  and actor_id = '00000000-0000-0000-0000-00000000000a'), 'admin action must be attributed';
end $$;

-- Inactive users lose all access immediately.
reset role;
update public.profiles set is_active = false where email = 'viewer@cit.edu';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
do $$ begin
  assert (select count(*) from public.documents) = 0, 'inactive user must not read documents';
  assert (select count(*) from public.profiles) = 1, 'inactive user only sees own profile';
end $$;
reset role;

\echo 'All schema tests passed.'
