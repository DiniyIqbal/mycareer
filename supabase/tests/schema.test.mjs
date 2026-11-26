// Applies every migration to an in-memory Postgres (PGlite) with stubbed
// Supabase auth/storage objects, then checks tenant isolation, RLS and the
// pipeline triggers. Run: npm run test:db  (no Docker needed)
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const migration = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  .map(f => readFileSync(join(migrationsDir, f), 'utf8')).join('\n');
const db = new PGlite();

const stubs = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create publication supabase_realtime;
-- Like current Supabase projects: no default table grants to API roles, so
-- the migrations must grant explicitly.
revoke all on schema public from public;
`;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };
const as = async (role, uid, fn) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
};
const one = async (sql, params) => (await db.query(sql, params)).rows;

await db.exec(stubs);
await db.exec(migration);
console.log('PASS  migration applied');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const HM = '33333333-3333-3333-3333-333333333333';
await db.exec(`insert into auth.users(id,email,raw_user_meta_data) values
  ('${A}','a@acme.test','{"full_name":"Aisha"}'),('${B}','b@other.test','{}'),('${HM}','hm@acme.test','{}')`);

const [{ create_organisation: orgA }] = await as('authenticated', A, () =>
  one(`select public.create_organisation('Acme Sdn Bhd','acme')`));
const [{ create_organisation: orgB }] = await as('authenticated', B, () =>
  one(`select public.create_organisation('Other Co','other-co')`));
ok(orgA && orgB, 'create_organisation works for two tenants');

const stages = await one(`select kind, id from pipeline_stages where org_id=$1 order by position`, [orgA]);
ok(stages.length === 7, `7 stages seeded (${stages.map(s => s.kind).join(',')})`);
const stage = Object.fromEntries(stages.map(s => [s.kind, s.id]));

// HR creates a draft job under RLS
const [{ id: jobId }] = await as('authenticated', A, () =>
  one(`insert into jobs(org_id,title,location) values ($1,'Customer Service Executive','Kuala Lumpur') returning id`, [orgA]));
const [{ id: draftId }] = await as('authenticated', A, () =>
  one(`insert into jobs(org_id,title) values ($1,'Draft role') returning id`, [orgA]));
ok(!!jobId, 'recruiter can create job under RLS');

let denied = false;
try { await as('authenticated', B, () => one(`insert into jobs(org_id,title) values ($1,'x')`, [orgA])); } catch { denied = true; }
ok(denied, 'other tenant cannot create job in org A');

await as('authenticated', A, () => one(`update jobs set status='published', published_at=now() where id=$1`, [jobId]));

const anonJobs = await as('anon', null, () => one(`select id, title from jobs`));
ok(anonJobs.length === 1 && anonJobs[0].id === jobId, 'anon sees only the published job');
let anonSettings = false;
try { await as('anon', null, () => one(`select settings from organisations`)); anonSettings = true; } catch {}
ok(!anonSettings, 'anon cannot read organisation settings column');
let anonCreatedBy = false;
try { await as('anon', null, () => one(`select created_by from jobs`)); anonCreatedBy = true; } catch {}
ok(!anonCreatedBy, 'anon cannot read jobs.created_by');

const otherSees = await as('authenticated', B, () => one(`select id from jobs where org_id=$1`, [orgA]));
ok(otherSees.length === 0, 'other tenant sees no org A jobs');

// Server (service role / superuser) writes an application
const [{ id: candId }] = await one(`insert into candidates(org_id,email,full_name) values ($1,'jane@mail.test','Jane') returning id`, [orgA]);
const [{ id: appId }] = await one(`insert into applications(org_id,job_id,candidate_id,stage_id) values ($1,$2,$3,$4) returning id`,
  [orgA, jobId, candId, stage.new]);
ok((await one(`select 1 from stage_history where application_id=$1`, [appId])).length === 1, 'insert writes stage_history');

let closedRejected = false;
try { await one(`insert into applications(org_id,job_id,candidate_id,stage_id) values ($1,$2,$3,$4)`, [orgA, draftId, candId, stage.new]); }
catch (e) { closedRejected = /not accepting/.test(e.message); }
ok(closedRejected, 'draft job rejects applications (DB guard)');

let crossTenant = false;
try { await one(`insert into applications(org_id,job_id,candidate_id,stage_id) values ($1,$2,$3,$4)`, [orgB, jobId, candId, stage.new]); }
catch { crossTenant = true; }
ok(crossTenant, 'composite FK blocks cross-tenant application');

// Stage changes under RLS
await as('authenticated', A, () => one(`update applications set stage_id=$1, rejection_reason='Missing licence' where id=$2`, [stage.rejected, appId]));
let msgs = await one(`select status, template_key, send_after > now() + interval '47 hours' as delayed from messages where application_id=$1`, [appId]);
ok(msgs.length === 1 && msgs[0].template_key === 'rejected' && msgs[0].delayed, 'Rejected queues 48h-delayed rejection email');
const hist = await one(`select changed_by, reason from stage_history where application_id=$1 order by id desc limit 1`, [appId]);
ok(hist[0].changed_by === A && hist[0].reason === 'Missing licence', 'history records actor and reason');
ok((await one(`select first_action_at is not null as v from applications where id=$1`, [appId]))[0].v, 'first_action_at set');

await as('authenticated', A, () => one(`update applications set stage_id=$1 where id=$2`, [stage.interview, appId]));
msgs = await one(`select template_key, status from messages where application_id=$1 order by created_at, template_key`, [appId]);
ok(msgs.some(m => m.template_key === 'rejected' && m.status === 'cancelled'), 'moving on cancels pending rejection (undo window)');
ok(msgs.some(m => m.template_key === 'interview_invite' && m.status === 'queued'), 'Interview queues invite');

// Paused automations
await one(`update jobs set automations_paused=true where id=$1`, [jobId]);
const before = (await one(`select count(*)::int n from messages`))[0].n;
await one(`update applications set stage_id=$1 where id=$2`, [stage.offer, appId]);
ok((await one(`select count(*)::int n from messages`))[0].n === before, 'paused job sends no automations');

// Hiring manager visibility
await one(`insert into members(org_id,user_id,role,email) values ($1,$2,'hiring_manager','hm@acme.test')`, [orgA, HM]);
ok((await as('authenticated', HM, () => one(`select id from applications`))).length === 0, 'unassigned HM sees no applications');
await one(`insert into job_assignments(org_id,job_id,user_id) values ($1,$2,$3)`, [orgA, jobId, HM]);
ok((await as('authenticated', HM, () => one(`select id from applications`))).length === 1, 'assigned HM sees the application');
ok((await as('authenticated', HM, () => one(`select id from candidates`))).length === 1, 'assigned HM sees the candidate');
const hmUpdate = await as('authenticated', HM, () => one(`update applications set stage_id=$1 where id=$2 returning id`, [stage.hired, appId]));
ok(hmUpdate.length === 0, 'HM cannot move stages');
ok((await as('authenticated', HM, () => one(`select id from audit_log`))).length === 0, 'HM cannot read audit log');

// Notes
await as('authenticated', HM, () => one(`insert into notes(org_id,application_id,author_id,body) values ($1,$2,$3,'Strong')`, [orgA, appId, HM]));
ok((await as('authenticated', B, () => one(`select id from notes`))).length === 0, 'other tenant cannot read notes');

// Audit log append-only
await one(`insert into audit_log(org_id,actor_id,action,entity) values ($1,$2,'resume.view','candidate_file')`, [orgA, A]);
let immutable = false;
try { await one(`delete from audit_log`); } catch { immutable = true; }
ok(immutable, 'audit_log is append-only');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
