# Sprint 1 – First Increment

## Scope

The proposal plans **two one-week sprints**. It makes the Internal Google
Workspace OAuth application a prerequisite of the first sprint, and orders the
iterations as database and interface design, Google Workspace integration, then
document registration and classification, before search, reporting and
administration. Sprint 1 therefore delivers the foundation that every later
feature depends on:

| Area | Use cases | Status |
|---|---|---|
| Database design – the complete data model of SDD Figure 2 | – | Done |
| Module 1 – User Access and Administration | UC-1.1 – UC-1.5 | Done |
| Module 2 – automatic registration and coding during the initial scan | UC-2.2 (steps 1–7) | Done |
| Dashboard (basic live counts and sync status) | part of UC-3.3 | Basic |

**Sprint 2 backlog:** incremental synchronization with pg_cron and the
`sync-drive` Edge Function (UC-2.1), the review screen for confirming and
correcting provisional codes and the Needs Classification queue (UC-2.2
steps 8–9, A1–A2), Update Document Record (UC-2.3), Incomplete Records
(UC-2.4), OCR (UC-2.5), Search and Preview (UC-3.1, UC-3.2), the full
dashboard (UC-3.3), and report templates and generation (UC-4.1, UC-4.2). The
tables for these features already exist.

## Requirement traceability

| Requirement | Implementation |
|---|---|
| FR-1.1.1 Google sign-in, university domain only | `login/google-sign-in-button.tsx` (`hd` hint); `auth/callback/route.ts` checks `ALLOWED_EMAIL_DOMAIN` on the server |
| FR-1.1.2 Deny accounts without an active profile | `auth/callback/route.ts`; `lib/auth.ts` re-checks on every request; RLS `current_app_role()` ignores inactive profiles |
| FR-1.1.3 / NFR-SE-08 20-minute idle timeout | `lib/supabase/proxy.ts` (server) and `components/idle-timer.tsx` (client) with an activity heartbeat |
| FR-1.1.4 Log successful and failed sign-ins | `sign_in` / `sign_in_failed` audit events |
| FR-1.2.1 Only Administrators manage profiles | RLS `profiles_admin_*`; `authorize("administrator")` in `admin/users/actions.ts` |
| FR-1.2.2 Three roles | enum `user_role` |
| FR-1.2.3 Protect the last active Administrator | trigger `protect_last_administrator` |
| FR-1.2.4 Old and new values of profile changes | trigger `audit_row_change` |
| FR-1.3.1 – FR-1.3.2 Filter and view audit entries | `admin/audit/page.tsx`, `admin/audit/filters.ts` |
| FR-1.3.3 / NFR-SE-05 Append-only audit log | trigger `prevent_audit_modification` (also blocks the service role and TRUNCATE); no write policies |
| UC-1.3 A1 CSV export, itself logged | `api/audit/export/route.ts`, `lib/domain/csv.ts` (CSV-injection safe) |
| FR-1.4.1 – FR-1.4.3 Codes, required fields, rules | `admin/reference/*`; rule patterns are validated; E2 rejects rules that refer to inactive codes |
| FR-1.4.2 Codes in use are never deleted | no delete policy on `categories` / `purposes`; FK constraints |
| FR-1.4.4 Seed the 8 categories and 13 purposes | migration section 7 |
| FR-1.5.1 – FR-1.5.2 Admin-only, access verified before save | `admin/drive/actions.ts` |
| FR-1.5.3 Initial scan records metadata only | `lib/sync/initial-scan.ts` |
| FR-1.5.4 / NFR-RE-04 Never move, rename or delete files | `lib/google/drive.ts` has no such calls; only `appProperties` are written |
| FR-1.5.5 / NFR-SE-03 Refresh token as a server-side secret | Supabase Vault through `set/get_google_refresh_token` (service role only) |
| FR-1.5.6 / NFR-RE-07 Excluded folders, including sub-folders | `FolderTree.isExcluded`; `register_document` refuses excluded files |
| UC-1.5 E2 Quota errors retried with backoff | `driveFetch` (exponential backoff, 5 retries) |
| FR-2.2.2 Rule-based classification | `lib/domain/classification.ts` |
| FR-2.2.3 – FR-2.2.4 / NFR-RE-03 Atomic, unique codes | `generate_document_code` (row-locked upsert) plus a unique constraint |
| FR-2.2.5 Automatic codes are provisional | `register_document(..., 'provisional')` |
| FR-2.2.8 Unmatched files are queued | `drive_files.registration_status = 'unclassified'` |
| FR-2.2.9 Code written to Drive `appProperties` | `setAppProperties`; failures leave `code_written_to_drive = false` for retry |
| FR-2.2.10 Missing required fields | trigger `check_document_completeness`; re-checked when rules change |
| FR-2.1.5 One run at a time | partial unique index `sync_runs_one_running` |
| NFR-SE-02 Permissions enforced in the database | RLS on every table, covered by `supabase/tests/local/schema_test.sql` |
| NFR-US-03 Actionable error messages | `lib/action-result.ts`, page-level messages |

## Design decisions made during the sprint

* **Pre-created auth accounts.** `profiles.id` references `auth.users` (SDD
  Figure 2), but Administrators add users before those users have ever signed
  in. *Add User* therefore creates the Supabase Auth account by e-mail, and the
  user's first Google sign-in links to it. Auth accounts that Google sign-in
  creates for unregistered people are deleted immediately.
* **Bootstrap Administrator.** While no Administrator exists, the account in
  `BOOTSTRAP_ADMIN_EMAIL` becomes the first Administrator on its first sign-in.
* **Initial scan host.** The SDD places the scan in the `sync-drive` Edge
  Function. In Sprint 1 it runs in the Next.js server after the Server Action
  responds (`after()`, `maxDuration = 300`). That is enough for about 500 files
  (NFR-PF-05). The logic lives in `lib/sync/initial-scan.ts` so Sprint 2 can
  move it into the Edge Function together with incremental sync.
* **Columns added to the data model.** `documents.code_written_to_drive` (the
  retry flag for UC-2.2 E2); `drive_config.connected_account_email`;
  `sync_runs.mode`, `files_registered` and `files_queued` (scan summary);
  `drive_files.parent_id`.
* **Rule semantics.** Patterns are case-insensitive regular expressions.
  Lower priority numbers run first, and ties go to the older rule.
* **Office timezone.** The YEAR segment and the audit date filters use
  Asia/Manila time.

## Known limitations

* The audit log keeps entries indefinitely. A job that purges entries older
  than two years (FR-1.3.4) is left for when the retention policy is confirmed.
* Changing to a different Shared Drive keeps the old drive's records. Flagging
  them for review comes with incremental sync (UC-2.1 A2).
* Deactivating a user blocks them on their next request, because every page,
  action and RLS policy checks `is_active`. Their Supabase refresh token is not
  revoked.
