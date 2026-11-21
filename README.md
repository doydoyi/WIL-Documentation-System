# WIL-Documentation-System
Documentation system integrated with Google Drive for the Wildcats Innovation Labs.# Wildcats Innovation Labs Office
## Document Management and Automated Reporting System

A centralized system for organizing digital documents, synchronizing a shared Google Drive, and generating standardized office reports.

## Project Overview

This project aims to improve the document management and reporting processes of the Wildcats Innovation Labs Office through a centralized web-based application.

The system is intended to help authorized office personnel register, identify, classify, organize, search, and retrieve digital documents while supporting the generation of standardized office reports.

## Technology Stack

- **Frontend:** JavaScript, React, Next.js
- **Backend:** Next.js server-side functionality
- **Database:** Supabase (PostgreSQL)
- **External Integration:** Google Workspace APIs (Google Drive, Google Docs)

## Planned Core Features

- User authentication and role-based access control
- Digital document registration and identification
- Document classification and organization
- Google Shared Drive integration and synchronization
- Document search, preview, and retrieval
- OCR-assisted document information extraction
- Automated report generation
- Dashboard and document masterlist
- Audit logging

*Features are subject to refinement during development.*

## Repository Structure

```text
├── docs/sprint-1.md            Sprint 1 scope, requirement traceability, decisions
├── scripts/test-db.sh          Runs the schema tests on a local PostgreSQL
├── supabase/
│   ├── migrations/             Database schema, RLS, functions, seed data
│   └── tests/local/            Schema tests (plain PostgreSQL + Supabase stubs)
└── src/
    ├── proxy.ts                Session refresh, route protection, idle timeout
    ├── app/
    │   ├── login/              UC-1.1 Sign in with Google
    │   ├── auth/               OAuth callback, sign-out, activity heartbeat
    │   ├── (app)/dashboard/    Dashboard
    │   ├── (app)/admin/users/  UC-1.2 Manage users and roles
    │   ├── (app)/admin/audit/  UC-1.3 View audit logs (+ /api/audit/export)
    │   ├── (app)/admin/reference/ UC-1.4 Manage reference codes and rules
    │   ├── (app)/admin/drive/  UC-1.5 Shared Drive connection and initial scan
    │   └── api/google/         Google OAuth for Shared Drive access
    ├── components/             Shared UI
    └── lib/
        ├── domain/             Pure logic: codes, classification, access, CSV (unit tested)
        ├── google/             Google OAuth and Drive API v3 client
        ├── sync/               Initial scan and automatic registration
        └── supabase/           Browser, server, proxy and service-role clients
```

## Development Setup

Requirements: Node.js 20.9+ and a Supabase project.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values.
3. Apply the database migration. Use the Supabase CLI (`supabase db push`), or
   run `supabase/migrations/*.sql` in the SQL editor.
4. In Supabase, go to **Authentication → Providers → Google** and enable Google
   sign-in with a Google OAuth client. Add `<site-url>/auth/callback` to
   **Authentication → URL Configuration → Redirect URLs**.
5. In the university Google Workspace, create the **Internal** OAuth client for
   Shared Drive access (this needs the Workspace administrator's approval). Add
   `<site-url>/api/google/callback` as an authorized redirect URI, and enable
   the Google Drive API and the Google Docs API.
6. Set `BOOTSTRAP_ADMIN_EMAIL` to the first Administrator's address, then start
   the app:

   ```bash
   npm run dev
   ```

   That person signs in first and adds the other users.

### Checks

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
PGHOST=/path/to/socket PGUSER=postgres npm run test:db
```

`test:db` applies the migrations to a scratch database on a local PostgreSQL
15+ server, using stand-ins for Supabase's `auth` and `vault` schemas. It then
tests code generation, completeness checks, the last-Administrator rule, the
append-only audit log and the RLS policies for each role.

## Environment Variables

Sensitive credentials and environment variables must not be committed to the
repository. All variables are documented in `.env.example`.
`SUPABASE_SECRET_KEY` and `GOOGLE_OAUTH_CLIENT_SECRET` are server-only.

## Contribution Guidelines

1. Use the `development` branch as the default integration branch.
2. Create a separate feature branch for each assigned task.
3. Commit changes using descriptive commit messages.
4. Submit a Pull Request to `development` when your work is ready for review.
5. Do not push unfinished or unreviewed changes directly to `main`.

## Branching Strategy

| Branch | Purpose |
|---|---|
| `main` | Stable project version |
| `development` | Shared integration and development |
| `feature/*` | Individual feature development |

## Project Status

**Sprint 1 (first increment) complete.** It covers the full database design,
Module 1 (sign-in, users and roles, audit logs, reference codes, Shared Drive
connection), and automatic registration and coding during the initial scan.
See [docs/sprint-1.md](docs/sprint-1.md) for the scope, the requirement
traceability and the Sprint 2 backlog.
