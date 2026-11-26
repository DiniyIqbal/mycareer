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

// Public application (AP-03/04) through submit_application
const [{ id: noticeA }] = await one(`select id from consent_notices where org_id=$1 and locale='en'`, [orgA]);
const [{ id: noticeB }] = await one(`select id from consent_notices where org_id=$1 and locale='en'`, [orgB]);
const submit = (job, email, notice, path) => one(
  `select public.submit_application($1,$2,'Ali Bin Abu','+60 12-345 6789','Asia/Kuala_Lumpur','en','linkedin',
     '{"q1":{"question":"Licence?","answer":"yes"}}'::jsonb,$3,$4,'cv.pdf','application/pdf',1234) as r`,
  [job, email, notice, path]);

let anonBlocked = false;
try { await as('anon', null, () => submit(jobId, 'ali@mail.test', noticeA, `${orgA}/x/1.pdf`)); } catch { anonBlocked = true; }
ok(anonBlocked, 'anon cannot call submit_application');

await one(`update jobs set automations_paused=false where id=$1`, [jobId]);
const [{ r: submitted }] = await as('service_role', null, () => submit(jobId, ' Ali@Mail.TEST ', noticeA, `${orgA}/x/2.pdf`));
const subApp = (await one(`select a.source, a.answers, a.resume_file_id is not null as has_file, c.email, s.kind
  from applications a join candidates c on c.id=a.candidate_id join pipeline_stages s on s.id=a.stage_id
  where a.id=$1`, [submitted.application_id]))[0];
ok(subApp?.email === 'ali@mail.test' && subApp.kind === 'new' && subApp.has_file && subApp.source === 'linkedin',
  'submit_application creates candidate, file and application in New');
ok((await one(`select 1 from consent_records where application_id=$1 and notice_id=$2`, [submitted.application_id, noticeA])).length === 1,
  'consent record stored with the notice shown');
const conf = (await one(`select template_key, status, respect_quiet_hours from messages where id=$1`, [submitted.message_id]))[0];
ok(conf?.template_key === 'application_received' && conf.status === 'queued' && conf.respect_quiet_hours === false,
  'confirmation email queued, exempt from quiet hours');

const errCode = async (fn) => { try { await fn(); return null; } catch (e) { return e.code; } };
ok(await errCode(() => as('service_role', null, () => submit(jobId, 'ali@mail.test', noticeA, `${orgA}/x/3.pdf`))) === '23505',
  'second application to the same job is rejected');
ok((await one(`select 1 from candidate_files where storage_path=$1`, [`${orgA}/x/3.pdf`])).length === 0,
  'rejected application leaves no file row behind');
ok(await errCode(() => as('service_role', null, () => submit(draftId, 'new@mail.test', noticeA, `${orgA}/x/4.pdf`))) === 'P0001',
  'draft job rejects public application');
ok(await errCode(() => as('service_role', null, () => submit(jobId, 'new@mail.test', noticeB, `${orgA}/x/5.pdf`))) === '22023',
  "another organisation's consent notice is rejected");

// Deleting an organisation with applications and consent records cascades cleanly
const D = '44444444-4444-4444-4444-444444444444';
await one(`insert into auth.users(id,email) values ($1,'d@gone.test')`, [D]);
const [{ create_organisation: orgD }] = await as('authenticated', D, () => one(`select public.create_organisation('Gone Co','gone-co')`));
const [{ id: jobD }] = await one(`insert into jobs(org_id,title,status,published_at) values ($1,'Temp','published',now()) returning id`, [orgD]);
const [{ id: noticeD }] = await one(`select id from consent_notices where org_id=$1 and locale='en'`, [orgD]);
await as('service_role', null, () => submit(jobD, 'temp@mail.test', noticeD, `${orgD}/x/1.pdf`));
let orgDeleted = true;
try { await one(`delete from organisations where id=$1`, [orgD]); } catch (e) { orgDeleted = false; console.log('   ', e.message); }
ok(orgDeleted && (await one(`select 1 from candidates where org_id=$1`, [orgD])).length === 0,
  'deleting an organisation removes its applications and consent records');
let stageInUse = false;
try { await one(`delete from pipeline_stages where id=$1`, [stage.new]); } catch { stageInUse = true; }
ok(stageInUse, 'a stage with applications cannot be deleted');

// Notes and notifications: owners may only change the intended columns
const [{ id: noteId }] = await one(`select id from notes limit 1`);
const [{ author_id: noteAuthor }] = await one(`select author_id from notes where id=$1`, [noteId]);
const edited = await as('authenticated', noteAuthor, () => one(`update notes set body='Strong, edited' where id=$1 returning id`, [noteId]));
ok(edited.length === 1, 'author can edit their note text');
let repoint = false;
try { await as('authenticated', noteAuthor, () => one(`update notes set org_id=$1 where id=$2`, [orgB, noteId])); } catch { repoint = true; }
ok(repoint, 'author cannot move a note to another organisation');
const otherEdit = await as('authenticated', A, () => one(`update notes set body='hijack' where id=$1 returning id`, [noteId]));
ok(otherEdit.length === 0, "colleague cannot edit someone else's note");
await one(`insert into notifications(org_id,user_id,kind,payload) values ($1,$2,'mention','{}')`, [orgA, A]);
let notifInsert = false;
try { await as('authenticated', A, () => one(`insert into notifications(org_id,user_id,kind) values ($1,$2,'mention')`, [orgA, HM])); } catch { notifInsert = true; }
ok(notifInsert, 'users cannot create notifications for others');
const marked = await as('authenticated', A, () => one(`update notifications set read_at=now() where user_id=$1 returning id`, [A]));
ok(marked.length === 1, 'user can mark own notification read');
let notifEdit = false;
try { await as('authenticated', A, () => one(`update notifications set payload='{"x":1}' where user_id=$1`, [A])); } catch { notifEdit = true; }
ok(notifEdit, 'user cannot rewrite a notification');
ok((await as('authenticated', HM, () => one(`select id from notifications`))).length === 0, "users cannot read others' notifications");

// Audit log: still immutable directly, but follows user / organisation deletion
let auditEdit = false;
try { await one(`update audit_log set action='tampered'`); } catch { auditEdit = true; }
ok(auditEdit, 'audit_log rows cannot be edited');
let auditNull = false;
try { await one(`update audit_log set actor_id=null`); } catch { auditNull = true; }
ok(auditNull, 'audit_log actor cannot be blanked while the user exists');

const E = '55555555-5555-5555-5555-555555555555';
await one(`insert into auth.users(id,email) values ($1,'e@leaving.test')`, [E]);
const [{ create_organisation: orgE }] = await as('authenticated', E, () => one(`select public.create_organisation('Leaving Co','leaving-co')`));
await one(`insert into audit_log(org_id,actor_id,action,entity) values ($1,$2,'resume.view','candidate_file')`, [orgE, E]);
await one(`insert into audit_log(org_id,actor_id,action,entity) values ($1,$2,'resume.view','candidate_file')`, [orgA, E]);
let soleAdminDelete = false;
try { await one(`delete from auth.users where id=$1`, [E]); } catch (e) { soleAdminDelete = /at least one admin/.test(e.message); }
ok(soleAdminDelete, "an organisation's only admin account cannot be deleted while the organisation exists");
let orgEDeleted = true;
try { await one(`delete from organisations where id=$1`, [orgE]); } catch (e) { orgEDeleted = false; console.log('   ', e.message); }
ok(orgEDeleted && (await one(`select 1 from audit_log where org_id=$1`, [orgE])).length === 0,
  'deleting an organisation with audit entries succeeds');
let userDeleted = true;
try { await one(`delete from auth.users where id=$1`, [E]); } catch (e) { userDeleted = false; console.log('   ', e.message); }
ok(userDeleted && (await one(`select 1 from audit_log where org_id=$1 and actor_id is null and action='resume.view'`, [orgA])).length >= 1,
  'deleting a user keeps their audit entries with actor cleared');

// Team invitations (accept_invitation) and member safeguards
const N = '66666666-6666-6666-6666-666666666666', W = '77777777-7777-7777-7777-777777777777';
await one(`insert into auth.users(id,email,raw_user_meta_data) values ($1,'New.Person@acme.test','{"full_name":"Nina"}'),($2,'wrong@acme.test','{}')`, [N, W]);
const invite = (hash, email, extra = '') => as('authenticated', A, () =>
  one(`insert into invitations(org_id,email,role,token_hash,invited_by${extra ? ',expires_at' : ''}) values ($1,$2,'recruiter',$3,$4${extra ? `,${extra}` : ''}) returning id`, [orgA, email, hash, A]));
await invite('h1', 'new.person@acme.test');
let hmInvite = false;
try { await as('authenticated', HM, () => one(`insert into invitations(org_id,email,role,token_hash,invited_by) values ($1,'x@y.test','admin','hx',$2)`, [orgA, HM])); } catch { hmInvite = true; }
ok(hmInvite, 'only admins can invite');
let dupInvite = false;
try { await invite('h1b', 'new.person@acme.test'); } catch { dupInvite = true; }
ok(dupInvite, 'one open invitation per email');
ok((await as('authenticated', HM, () => one(`select id from invitations`))).length === 0, "non-admins cannot see invitations");

const accept = (uid, hash) => errCode(() => as('authenticated', uid, () => one(`select public.accept_invitation($1)`, [hash])));
ok(await accept(W, 'h1') === 'MC404', 'invitation for another email is refused');
ok(await accept(N, 'nope') === 'MC401', 'unknown token is refused');
ok(await accept(N, 'h1') === null, 'invited person accepts (email matched case-insensitively)');
const nRow = await one(`select role, full_name from members where org_id=$1 and user_id=$2`, [orgA, N]);
ok(nRow[0]?.role === 'recruiter' && nRow[0].full_name === 'Nina', 'they join with the invited role and their name');
ok(await accept(N, 'h1') === 'MC402', 'an invitation works only once');
await invite('h2', 'wrong@acme.test', "now() - interval '1 day'");
ok(await accept(W, 'h2') === 'MC403', 'expired invitation is refused');
await one(`update invitations set expires_at = now() + interval '1 day' where token_hash='h2'`);
await as('authenticated', A, () => one(`update invitations set revoked_at = now() where token_hash='h2'`));
ok(await accept(W, 'h2') === 'MC401', 'revoked invitation is refused');
await invite('h3', 'b@other.test');
ok(await accept(B, 'h3') === 'MC405', 'someone already in another organisation cannot join a second');

let selfDemote = false;
try { await as('authenticated', A, () => one(`update members set role='recruiter' where org_id=$1 and user_id=$2`, [orgA, A])); } catch (e) { selfDemote = /at least one admin/.test(e.message); }
ok(selfDemote, 'the last admin cannot be demoted');
let selfRemove = false;
try { await as('authenticated', A, () => one(`delete from members where org_id=$1 and user_id=$2`, [orgA, A])); } catch (e) { selfRemove = /at least one admin/.test(e.message); }
ok(selfRemove, 'the last admin cannot be removed');
await as('authenticated', A, () => one(`update members set role='admin' where org_id=$1 and user_id=$2`, [orgA, N]));
await as('authenticated', N, () => one(`update members set role='recruiter' where org_id=$1 and user_id=$2`, [orgA, N]));
ok((await one(`select role from members where user_id=$1`, [N]))[0].role === 'recruiter', 'with two admins, one can step down');
let memberInsert = false;
try { await as('authenticated', A, () => one(`insert into members(org_id,user_id,role,email) values ($1,$2,'admin','w@x.test')`, [orgA, W])); } catch { memberInsert = true; }
ok(memberInsert, 'members cannot be added directly, only by invitation');
let emailEdit = false;
try { await as('authenticated', A, () => one(`update members set email='spoof@x.test' where user_id=$1`, [N])); } catch { emailEdit = true; }
ok(emailEdit, "admins cannot change a member's email");
const hmByRecruiter = await as('authenticated', N, () => one(`update members set role='admin' where user_id=$1 returning user_id`, [HM]));
ok(hmByRecruiter.length === 0, 'recruiters cannot change roles');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
