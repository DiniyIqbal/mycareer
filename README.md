# mycareer

Applicant tracking system (ATS) for small and mid-size organisations: post a job once, receive every application in one pipeline, and keep candidates informed automatically.

**Stack:** Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, Storage, RLS) · Resend

## Decisions (2026-11-26)

| Topic | Decision |
|---|---|
| Tenancy | Multi-tenant from day one. Every row has `org_id`; child tables use composite `(org_id, id)` foreign keys. |
| Public pages | Next.js server-rendered careers pages with Google Jobs `JobPosting` JSON-LD, cached with `use cache`. |
| Email | Gmail SMTP for testing now, Resend for production. Switch with `EMAIL_PROVIDER`; app code only calls `sendEmail()` in `src/lib/email`. |
| Resume formats | PDF and DOCX. DOCX is converted to PDF server-side for the in-app viewer. |
| Status emails in MVP | Yes: minimal stage-change automations (Interview, Offer, Rejected after 48h). Moving a candidate again cancels pending automated emails. |
| Quiet hours | Automated messages respect 8am–9pm candidate local time; the application confirmation is transactional and exempt. |

## Getting started

```bash
cp .env.example .env.local   # fill in Supabase + Resend keys
npm install
npx supabase link --project-ref <ref>
npx supabase db push --remote   # applies supabase/migrations (CLI v3 defaults to a local stack)
npm run dev
```

In Supabase Auth → URL Configuration, set Site URL to `http://localhost:3000` and add `http://localhost:3000/**` to Redirect URLs. The default email templates work; custom ones may link to
`{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run email:test -- you@example.com` | Sends one test email with the Gmail settings in `.env.local` |
| `npm run test:db` | Applies all migrations to in-memory Postgres (PGlite) and checks RLS, tenant isolation and pipeline triggers. No Docker needed. |

## Email queue worker

Stage moves queue emails in `messages` (interview invite and offer at once, rejection after 48 hours). Due emails are sent straight after the move. Delayed ones, and ones held back by quiet hours (8am–9pm in the candidate's time zone) or a failed attempt, are sent by `GET /api/cron/messages`. Call it every 5 minutes with `Authorization: Bearer $CRON_SECRET`:

- **Vercel:** add `{"crons":[{"path":"/api/cron/messages","schedule":"*/5 * * * *"}]}` to `vercel.json` and set `CRON_SECRET`. Vercel sends the header itself.
- **Anywhere else:** any scheduler, e.g. `curl -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/cron/messages`.
- **Locally:** run that curl against `http://localhost:3000` when you want delayed emails to go out.

## Layout

```
src/app/careers/[org]            public careers page + job detail (JSON-LD)
src/app/app/(workspace)          HR app (requires membership)
src/app/app/onboarding           create organisation → caller becomes Org Admin
src/app/login, src/app/auth      sign-in / sign-up / email confirmation
src/lib/supabase                 server (user, RLS), public (anon, cacheable), admin (service role)
src/proxy.ts                     session refresh + optimistic /app guard
supabase/migrations              schema, RLS, triggers, seed per organisation
supabase/tests                   schema test (PGlite)
```

## Security notes

- Authorisation lives in Postgres RLS; the proxy is only an optimistic redirect.
- Anonymous users can read only public columns of organisations and published jobs.
- Applications are written by the server (service role) after validation, consent and upload checks — anon has no insert rights. `public.submit_application` does all the inserts in one transaction and is executable by `service_role` only.
- Resume type is checked from the file's bytes (`%PDF-` / Word ZIP), not its name or browser MIME type. New files are `scan_status = 'pending'`; **no malware scanner is wired up yet**. Until one is, HR can open pending files (with a warning on the profile); files marked `infected` are refused. Resumes are served from the storage domain via 60-second signed URLs, never from the app's origin.
- `audit_log` is append-only. The only exceptions are cascades: deleting an organisation removes its log, and deleting a user clears `actor_id`.
- The public form has a honeypot field but no rate limit yet; add one (e.g. per IP at the edge) before launch.
- The seeded privacy notice is marked DRAFT and needs legal review before real candidates apply.
- Resumes live in a private bucket with no client policies; access goes through the server, which writes `audit_log` and returns a short-lived signed URL.
- Supabase grants new tables to `anon` by default: every new migration must enable RLS and revoke/grant explicitly.

## MVP progress

- [x] Schema, RLS, triggers, org bootstrap
- [x] Auth, onboarding, HR shell, dashboard (HR-01)
- [x] Careers list + job detail with Google Jobs markup (AP-01, AP-02)
- [x] Job create/edit/publish/close/archive with screening questions (HR-02, HR-03)
- [x] Application form: resume upload, screening answers, PDPA consent, confirmation email (AP-03, AP-04)
- [ ] Malware scanning and DOCX→PDF preview for uploaded resumes
- [x] Candidate list + profile + audited resume access (HR-04, HR-05)
- [x] Pipeline board with realtime, rejection reason and undo (HR-06)
- [ ] Notes, @mentions, hiring-manager assignment, templates (HR-07, HR-08)
- [x] Message sender worker (quiet hours, retries); needs a scheduler in production
- [ ] Recover messages stuck in `sending` if a send crashes mid-way
- [ ] Data export/deletion requests (AP-05), PWA, Bahasa Melayu, WCAG pass
