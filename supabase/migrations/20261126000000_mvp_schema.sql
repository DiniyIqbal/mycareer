-- =============================================================================
-- MyCareer ATS — MVP schema
--
-- Principles (see PRD §3, §11, §13):
--   * Multi-tenant from day one: every row carries org_id, and child rows use
--     composite (org_id, id) foreign keys so cross-tenant links are impossible.
--   * Row-level security on every table. Anonymous users can only read public
--     columns of organisations and published jobs. Applications are written by
--     the server (service role) after validation, consent and upload checks.
--   * Pipeline stages are rows, not an enum, so Phase 2 (Assessment,
--     Shortlisted) and Phase 3 (custom stages) need no rewrite.
--   * `messages` doubles as the outbound queue: stage-change automations
--     enqueue rows; a worker sends them, honouring quiet hours and retries.
-- =============================================================================

create schema if not exists private;
grant usage on schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.member_role      as enum ('admin', 'recruiter', 'hiring_manager');
create type public.job_status       as enum ('draft', 'published', 'closed', 'archived');
create type public.employment_type  as enum ('full_time', 'part_time', 'contractor', 'temporary', 'intern', 'other');
create type public.workplace_type   as enum ('onsite', 'hybrid', 'remote');
create type public.salary_period    as enum ('hour', 'day', 'month', 'year');
create type public.stage_kind       as enum ('new', 'under_review', 'assessment', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'withdrawn');
create type public.message_channel  as enum ('email', 'sms', 'whatsapp');
create type public.message_status   as enum ('queued', 'sending', 'sent', 'failed', 'cancelled');
create type public.scan_status      as enum ('pending', 'clean', 'infected', 'error');
create type public.data_request_kind   as enum ('export', 'delete', 'correct');
create type public.data_request_status as enum ('unverified', 'open', 'completed', 'rejected');
create type public.automation_action   as enum ('send_template', 'notify_user');

-- -----------------------------------------------------------------------------
-- Shared trigger: updated_at
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Organisations and members
-- -----------------------------------------------------------------------------
create table public.organisations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 200),
  slug        text not null unique
              check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'
                     and slug not in ('admin','api','app','auth','careers','login','logout','signup','settings','www')),
  logo_path   text,
  website     text,
  timezone    text not null default 'Asia/Kuala_Lumpur',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger organisations_updated_at before update on public.organisations
  for each row execute function private.set_updated_at();

create table public.members (
  org_id               uuid not null references public.organisations(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  role                 public.member_role not null,
  full_name            text not null default '',
  email                text not null,
  -- PRD §9: separate permission, not a role. Phase 2.
  is_assessment_owner  boolean not null default false,
  created_at           timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on public.members(user_id);

create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, name)
);

create table public.pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  kind         public.stage_kind not null,
  name         text not null,
  -- Applicant-facing wording (AP-07), never internal detail.
  public_label text not null,
  position     int  not null,
  is_terminal  boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, kind)  -- relaxed in Phase 3 when custom stages arrive
);

-- -----------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER so they can read members under RLS).
-- Kept in `private` so PostgREST does not expose them as RPC.
-- -----------------------------------------------------------------------------
create or replace function private.has_org_role(p_org uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.org_id = p_org and m.user_id = (select auth.uid()) and m.role = any(p_roles)
  );
$$;

create or replace function private.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_hr(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_org_role(p_org, array['admin','recruiter']::public.member_role[]);
$$;

grant execute on all functions in schema private to authenticated;

-- -----------------------------------------------------------------------------
-- Jobs
-- -----------------------------------------------------------------------------
create table public.jobs (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organisations(id) on delete cascade,
  department_id        uuid,
  title                text not null check (length(trim(title)) between 1 and 200),
  description          text not null default '',
  location             text not null default '',
  -- Google Jobs JobPosting fields (PRD AP-02)
  address_locality     text,
  address_region       text,
  address_country      text not null default 'MY',
  workplace_type       public.workplace_type not null default 'onsite',
  employment_type      public.employment_type not null default 'full_time',
  salary_min           numeric(12,2),
  salary_max           numeric(12,2),
  salary_currency      text not null default 'MYR',
  salary_period        public.salary_period,
  -- [{id, label, type: 'text'|'yes_no'|'choice', required, options?}]
  screening_questions  jsonb not null default '[]'::jsonb,
  status               public.job_status not null default 'draft',
  published_at         timestamptz,
  closes_at            timestamptz,
  automations_paused   boolean not null default false,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, department_id) references public.departments(org_id, id),
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  check (jsonb_typeof(screening_questions) = 'array'),
  check (status <> 'published' or published_at is not null)
);
create index jobs_org_status_idx on public.jobs(org_id, status);
create trigger jobs_updated_at before update on public.jobs
  for each row execute function private.set_updated_at();

-- Hiring managers see only jobs assigned to them (HR-08).
create table public.job_assignments (
  org_id      uuid not null,
  job_id      uuid not null,
  user_id     uuid not null,
  created_at  timestamptz not null default now(),
  primary key (job_id, user_id),
  foreign key (org_id, job_id)  references public.jobs(org_id, id) on delete cascade,
  foreign key (org_id, user_id) references public.members(org_id, user_id) on delete cascade
);
create index job_assignments_user_idx on public.job_assignments(user_id);

create or replace function private.is_assigned_hm(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.job_assignments a
    join public.members m on m.org_id = a.org_id and m.user_id = a.user_id
    where a.job_id = p_job and a.user_id = (select auth.uid()) and m.role = 'hiring_manager'
  );
$$;

-- For rows that reference a job. Policies on `jobs` itself use
-- is_hr(org_id) or is_assigned_hm(id) instead, because a row being inserted
-- is not yet visible to a lookup (breaks INSERT ... RETURNING).
create or replace function private.can_access_job(p_job uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.jobs j
    where j.id = p_job and (private.is_hr(j.org_id) or private.is_assigned_hm(j.id))
  );
$$;
grant execute on function private.is_assigned_hm(uuid), private.can_access_job(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Candidates, files, applications
-- -----------------------------------------------------------------------------
create table public.candidates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  email       text not null check (email = lower(email) and position('@' in email) > 1),
  full_name   text not null,
  phone       text,
  -- Needed for quiet hours (PRD §8). Captured from the browser at apply time.
  timezone    text,
  locale      text not null default 'en' check (locale in ('en', 'ms')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, email)
);
create trigger candidates_updated_at before update on public.candidates
  for each row execute function private.set_updated_at();

create table public.candidate_files (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  candidate_id    uuid not null,
  kind            text not null default 'resume',
  storage_path    text not null unique,
  -- DOCX resumes are converted server-side so the in-app viewer is PDF-only.
  preview_path    text,
  original_name   text not null,
  mime_type       text not null check (mime_type in (
                    'application/pdf',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes      int  not null check (size_bytes > 0 and size_bytes <= 10485760),
  scan_status     public.scan_status not null default 'pending',
  created_at      timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, candidate_id) references public.candidates(org_id, id) on delete cascade
);

create table public.applications (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null,
  job_id            uuid not null,
  candidate_id      uuid not null,
  stage_id          uuid not null,
  resume_file_id    uuid,
  -- PRD §10: from the ?src= tracking parameter on the job link.
  source            text not null default 'careers_page',
  answers           jsonb not null default '{}'::jsonb,
  rejection_reason  text,
  submitted_at      timestamptz not null default now(),
  stage_changed_at  timestamptz not null default now(),
  first_action_at   timestamptz,   -- success metric: time to first HR action
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, id),
  unique (job_id, candidate_id),
  foreign key (org_id, job_id)         references public.jobs(org_id, id) on delete cascade,
  foreign key (org_id, candidate_id)   references public.candidates(org_id, id) on delete cascade,
  foreign key (org_id, stage_id)       references public.pipeline_stages(org_id, id),
  foreign key (org_id, resume_file_id) references public.candidate_files(org_id, id) on delete set null (resume_file_id)
);
create index applications_job_stage_idx on public.applications(job_id, stage_id);
create index applications_candidate_idx on public.applications(candidate_id);
create index applications_org_submitted_idx on public.applications(org_id, submitted_at desc);
create trigger applications_updated_at before update on public.applications
  for each row execute function private.set_updated_at();

create or replace function private.can_access_application(p_app uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.id = p_app and private.can_access_job(a.job_id)
  );
$$;

-- Hiring-manager path only; HR access is checked on the row's org_id.
create or replace function private.can_access_candidate(p_candidate uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.applications a
    where a.candidate_id = p_candidate and private.is_assigned_hm(a.job_id)
  );
$$;
grant execute on function private.can_access_application(uuid), private.can_access_candidate(uuid) to authenticated;

-- Closed / draft jobs reject new applications (HR-03), enforced in the DB.
create or replace function private.applications_guard_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status public.job_status;
  v_closes timestamptz;
begin
  select status, closes_at into v_status, v_closes from public.jobs where id = new.job_id;
  if v_status is distinct from 'published' or (v_closes is not null and v_closes < now()) then
    raise exception 'Job is not accepting applications' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger applications_guard_insert before insert on public.applications
  for each row execute function private.applications_guard_insert();

-- -----------------------------------------------------------------------------
-- Stage history (HR-05) — written only by trigger
-- -----------------------------------------------------------------------------
create table public.stage_history (
  id              bigint generated always as identity primary key,
  org_id          uuid not null,
  application_id  uuid not null,
  from_stage_id   uuid,
  to_stage_id     uuid not null,
  changed_by      uuid references auth.users(id) on delete set null,
  reason          text,
  changed_at      timestamptz not null default now(),
  foreign key (org_id, application_id) references public.applications(org_id, id) on delete cascade
);
create index stage_history_app_idx on public.stage_history(application_id, changed_at);

-- -----------------------------------------------------------------------------
-- Notes, notifications (@mentions)
-- -----------------------------------------------------------------------------
create table public.notes (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  application_id  uuid not null,
  author_id       uuid not null references auth.users(id) on delete cascade,
  body            text not null check (length(trim(body)) between 1 and 10000),
  mentions        uuid[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (org_id, application_id) references public.applications(org_id, id) on delete cascade
);
create index notes_app_idx on public.notes(application_id, created_at);
create trigger notes_updated_at before update on public.notes
  for each row execute function private.set_updated_at();

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

-- -----------------------------------------------------------------------------
-- Messaging: templates, automation rules, messages (also the send queue)
-- -----------------------------------------------------------------------------
create table public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organisations(id) on delete cascade,
  key         text,      -- system templates: 'application_received', 'rejected', ...
  name        text not null,
  channel     public.message_channel not null default 'email',
  locale      text not null default 'en' check (locale in ('en', 'ms')),
  subject     text,
  -- Variables: {{candidate_name}} {{job_title}} {{company_name}} {{interview_time}}
  body        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, key, locale, channel)
);
create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function private.set_updated_at();

create table public.automation_rules (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations(id) on delete cascade,
  job_id              uuid,            -- null = org-wide default
  trigger_stage_kind  public.stage_kind not null,
  delay_minutes       int not null default 0 check (delay_minutes between 0 and 43200),
  action              public.automation_action not null default 'send_template',
  template_key        text,            -- resolved per candidate locale at send time
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  foreign key (org_id, job_id) references public.jobs(org_id, id) on delete cascade,
  check (action <> 'send_template' or template_key is not null)
);
create unique index automation_rules_scope_uq
  on public.automation_rules(org_id, coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid), trigger_stage_kind, action);

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null,
  application_id      uuid not null,
  channel             public.message_channel not null default 'email',
  template_key        text,
  automation_rule_id  uuid references public.automation_rules(id) on delete set null,
  to_address          text not null,
  subject             text,
  body                text,            -- rendered at send time if null
  status              public.message_status not null default 'queued',
  -- Transactional messages (e.g. application confirmation) are exempt from
  -- quiet hours (PRD §8 vs AP-04); automations are not.
  respect_quiet_hours boolean not null default true,
  send_after          timestamptz not null default now(),
  attempts            int not null default 0 check (attempts between 0 and 10),
  last_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  foreign key (org_id, application_id) references public.applications(org_id, id) on delete cascade
);
create index messages_queue_idx on public.messages(send_after) where status = 'queued';
create index messages_app_idx on public.messages(application_id, created_at);

-- -----------------------------------------------------------------------------
-- Stage-change trigger: history, first-action metric, automations
-- -----------------------------------------------------------------------------
create or replace function private.applications_on_stage_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.stage_kind;
begin
  if tg_op = 'INSERT' then
    insert into public.stage_history(org_id, application_id, from_stage_id, to_stage_id, changed_by)
    values (new.org_id, new.id, null, new.stage_id, (select auth.uid()));
    return new;
  end if;

  if new.stage_id is not distinct from old.stage_id then
    return new;
  end if;

  select kind into v_kind from public.pipeline_stages where id = new.stage_id;

  insert into public.stage_history(org_id, application_id, from_stage_id, to_stage_id, changed_by, reason)
  values (new.org_id, new.id, old.stage_id, new.stage_id, (select auth.uid()),
          case when v_kind = 'rejected' then new.rejection_reason end);

  -- A stage change cancels automated messages still waiting from the previous
  -- stage: this is HR's undo window for a mistaken move (e.g. to Rejected).
  update public.messages
     set status = 'cancelled'
   where application_id = new.id and status = 'queued' and automation_rule_id is not null;

  insert into public.messages(org_id, application_id, channel, template_key, automation_rule_id,
                              to_address, send_after, respect_quiet_hours)
  select new.org_id, new.id, 'email', r.template_key, r.id,
         c.email, now() + make_interval(mins => r.delay_minutes), true
    from public.automation_rules r
    join public.candidates c on c.id = new.candidate_id
    join public.jobs j       on j.id = new.job_id
   where r.org_id = new.org_id
     and r.active
     and r.action = 'send_template'
     and r.trigger_stage_kind = v_kind
     and not j.automations_paused
     and (r.job_id = new.job_id
          or (r.job_id is null and not exists (
                select 1 from public.automation_rules r2
                 where r2.job_id = new.job_id and r2.trigger_stage_kind = v_kind
                   and r2.action = 'send_template')));

  return new;
end $$;

create or replace function private.applications_before_stage_change()
returns trigger language plpgsql as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.stage_changed_at := now();
    if old.first_action_at is null then
      new.first_action_at := now();
    end if;
  end if;
  return new;
end $$;

create trigger applications_before_stage_change before update of stage_id on public.applications
  for each row execute function private.applications_before_stage_change();
create trigger applications_after_insert after insert on public.applications
  for each row execute function private.applications_on_stage_change();
create trigger applications_after_stage_change after update of stage_id on public.applications
  for each row execute function private.applications_on_stage_change();

-- -----------------------------------------------------------------------------
-- PDPA: consent notices and records, data-subject requests
-- -----------------------------------------------------------------------------
create table public.consent_notices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  purpose       text not null default 'application',   -- 'assessment' in Phase 2
  version       int  not null,
  locale        text not null default 'en' check (locale in ('en', 'ms')),
  body          text not null,
  published_at  timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, purpose, locale, version)
);

create table public.consent_records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  candidate_id    uuid not null,
  application_id  uuid,
  notice_id       uuid not null,
  purpose         text not null,
  given_at        timestamptz not null default now(),
  withdrawn_at    timestamptz,
  foreign key (org_id, candidate_id)   references public.candidates(org_id, id) on delete cascade,
  foreign key (org_id, application_id) references public.applications(org_id, id) on delete cascade,
  foreign key (org_id, notice_id)      references public.consent_notices(org_id, id)
);
create index consent_records_candidate_idx on public.consent_records(candidate_id);

-- AP-05. Created unverified; becomes 'open' after the email link is clicked.
create table public.data_requests (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations(id) on delete cascade,
  candidate_id  uuid,
  email         text not null check (email = lower(email)),
  kind          public.data_request_kind not null,
  details       text,
  status        public.data_request_status not null default 'unverified',
  verified_at   timestamptz,
  due_at        timestamptz,  -- set on verification; PDPA response window
  handled_by    uuid references auth.users(id) on delete set null,
  handled_at    timestamptz,
  created_at    timestamptz not null default now(),
  foreign key (org_id, candidate_id) references public.candidates(org_id, id) on delete set null (candidate_id)
);
create index data_requests_org_status_idx on public.data_requests(org_id, status);

-- -----------------------------------------------------------------------------
-- Analytics: job views (no personal data) and the audit log
-- -----------------------------------------------------------------------------
create table public.job_views (
  id         bigint generated always as identity primary key,
  org_id     uuid not null,
  job_id     uuid not null,
  source     text not null default 'direct',
  viewed_at  timestamptz not null default now(),
  foreign key (org_id, job_id) references public.jobs(org_id, id) on delete cascade
);
create index job_views_job_idx on public.job_views(job_id, viewed_at);

-- Append-only. Written by the server for views/exports and by triggers.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null references public.organisations(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,       -- 'resume.view', 'candidate.export', 'job.publish', ...
  entity      text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log(org_id, created_at desc);

create or replace function private.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- -----------------------------------------------------------------------------
-- Organisation bootstrap: stages, templates, automations, consent notice
-- -----------------------------------------------------------------------------
create or replace function private.seed_organisation(p_org uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.pipeline_stages(org_id, kind, name, public_label, position, is_terminal) values
    (p_org, 'new',          'New',          'Application received', 10, false),
    (p_org, 'under_review', 'Under review', 'Under review',         20, false),
    (p_org, 'interview',    'Interview',    'Interview',            50, false),
    (p_org, 'offer',        'Offer',        'Offer',                60, false),
    (p_org, 'hired',        'Hired',        'Hired',                70, true),
    (p_org, 'rejected',     'Rejected',     'Not progressing',      80, true),
    (p_org, 'withdrawn',    'Withdrawn',    'Withdrawn',            90, true);
  -- Phase 2 inserts 'assessment' (30) and 'shortlisted' (40).

  insert into public.message_templates(org_id, key, name, locale, subject, body) values
    (p_org, 'application_received', 'Application received', 'en',
     'We received your application for {{job_title}}',
     E'Hi {{candidate_name}},\n\nThank you for applying for {{job_title}} at {{company_name}}. Our team will review your application and contact you about next steps.\n\n{{company_name}}'),
    (p_org, 'application_received', 'Permohonan diterima', 'ms',
     'Permohonan anda untuk {{job_title}} telah diterima',
     E'Hai {{candidate_name}},\n\nTerima kasih kerana memohon jawatan {{job_title}} di {{company_name}}. Pasukan kami akan menyemak permohonan anda dan menghubungi anda tentang langkah seterusnya.\n\n{{company_name}}'),
    (p_org, 'interview_invite', 'Interview invitation', 'en',
     'Interview for {{job_title}}',
     E'Hi {{candidate_name}},\n\nGood news: we would like to invite you to interview for {{job_title}}. We will contact you shortly to arrange a time.\n\n{{company_name}}'),
    (p_org, 'offer_pending', 'Offer pending', 'en',
     'An update on your application for {{job_title}}',
     E'Hi {{candidate_name}},\n\nWe are preparing an offer for {{job_title}} and will be in touch soon.\n\n{{company_name}}'),
    (p_org, 'rejected', 'Not progressing', 'en',
     'Your application for {{job_title}}',
     E'Hi {{candidate_name}},\n\nThank you for your interest in {{job_title}} at {{company_name}}. After careful review, we will not be moving forward with your application at this time. We wish you the best in your search.\n\n{{company_name}}');

  -- Minimal stage-change automations pulled into the MVP (decision 2026-11-26).
  -- Rejection waits 48h, giving HR a window to undo by moving the candidate.
  insert into public.automation_rules(org_id, trigger_stage_kind, delay_minutes, template_key) values
    (p_org, 'interview', 0,    'interview_invite'),
    (p_org, 'offer',     0,    'offer_pending'),
    (p_org, 'rejected',  2880, 'rejected');

  insert into public.consent_notices(org_id, purpose, version, locale, body) values
    (p_org, 'application', 1, 'en',
     'DRAFT — pending legal review. We collect your details and resume to assess your application for this role and to contact you about it. We keep this data for 12 months after the role closes unless you agree to stay in our talent pool. You can ask to access, correct, export or delete your data at any time.'),
    (p_org, 'application', 1, 'ms',
     'DRAF — menunggu semakan undang-undang. Kami mengumpul butiran dan resume anda untuk menilai permohonan anda bagi jawatan ini dan menghubungi anda mengenainya. Data ini disimpan selama 12 bulan selepas jawatan ditutup melainkan anda bersetuju untuk kekal dalam kumpulan bakat kami. Anda boleh meminta untuk mengakses, membetulkan, mengeksport atau memadam data anda pada bila-bila masa.');
end $$;

-- Called by a signed-in user during onboarding. Makes them the Org Admin.
create or replace function public.create_organisation(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid;
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select u.email, coalesce(u.raw_user_meta_data->>'full_name', '')
    into v_email, v_name
    from auth.users u where u.id = v_uid;

  insert into public.organisations(name, slug) values (trim(p_name), lower(trim(p_slug)))
  returning id into v_org;

  insert into public.members(org_id, user_id, role, full_name, email)
  values (v_org, v_uid, 'admin', v_name, v_email);

  perform private.seed_organisation(v_org);
  return v_org;
end $$;
revoke execute on function private.seed_organisation(uuid) from public, anon, authenticated;
revoke execute on function public.create_organisation(text, text) from public, anon;
grant execute on function public.create_organisation(text, text) to authenticated;

-- =============================================================================
-- Row-level security
-- =============================================================================
alter table public.organisations     enable row level security;
alter table public.members           enable row level security;
alter table public.departments       enable row level security;
alter table public.pipeline_stages   enable row level security;
alter table public.jobs              enable row level security;
alter table public.job_assignments   enable row level security;
alter table public.candidates        enable row level security;
alter table public.candidate_files   enable row level security;
alter table public.applications      enable row level security;
alter table public.stage_history     enable row level security;
alter table public.notes             enable row level security;
alter table public.notifications     enable row level security;
alter table public.message_templates enable row level security;
alter table public.automation_rules  enable row level security;
alter table public.messages          enable row level security;
alter table public.consent_notices   enable row level security;
alter table public.consent_records   enable row level security;
alter table public.data_requests     enable row level security;
alter table public.job_views         enable row level security;
alter table public.audit_log         enable row level security;

-- Anonymous visitors: public columns of organisations and published jobs only.
revoke all on all tables in schema public from anon;
grant select (id, name, slug, logo_path, website) on public.organisations to anon;
grant select (id, org_id, department_id, title, description, location, address_locality,
              address_region, address_country, workplace_type, employment_type,
              salary_min, salary_max, salary_currency, salary_period,
              screening_questions, status, published_at, closes_at)
  on public.jobs to anon;
grant select (org_id, purpose, version, locale, body, id) on public.consent_notices to anon;

create policy "public can read organisations" on public.organisations
  for select to anon using (true);
create policy "public can read published jobs" on public.jobs
  for select to anon using (status = 'published');
create policy "public can read consent notices" on public.consent_notices
  for select to anon using (true);

-- organisations
create policy "members read own org" on public.organisations
  for select to authenticated using (private.is_org_member(id));
create policy "admins update org" on public.organisations
  for update to authenticated
  using (private.has_org_role(id, array['admin']::public.member_role[]))
  with check (private.has_org_role(id, array['admin']::public.member_role[]));

-- members
create policy "members read colleagues" on public.members
  for select to authenticated using (private.is_org_member(org_id));
create policy "admins manage members" on public.members
  for all to authenticated
  using (private.has_org_role(org_id, array['admin']::public.member_role[]))
  with check (private.has_org_role(org_id, array['admin']::public.member_role[]));

-- departments, pipeline stages: read by members, managed by HR / admins
create policy "members read departments" on public.departments
  for select to authenticated using (private.is_org_member(org_id));
create policy "hr manage departments" on public.departments
  for all to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

create policy "members read stages" on public.pipeline_stages
  for select to authenticated using (private.is_org_member(org_id));
create policy "admins manage stages" on public.pipeline_stages
  for all to authenticated
  using (private.has_org_role(org_id, array['admin']::public.member_role[]))
  with check (private.has_org_role(org_id, array['admin']::public.member_role[]));

-- jobs (no delete: jobs are archived)
create policy "read accessible jobs" on public.jobs
  for select to authenticated using (private.is_hr(org_id) or private.is_assigned_hm(id));
create policy "hr create jobs" on public.jobs
  for insert to authenticated with check (private.is_hr(org_id));
create policy "hr update jobs" on public.jobs
  for update to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

-- job assignments
create policy "members read assignments" on public.job_assignments
  for select to authenticated using (private.is_org_member(org_id));
create policy "hr manage assignments" on public.job_assignments
  for all to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

-- candidates and files (metadata only; file bytes go through signed links)
create policy "read accessible candidates" on public.candidates
  for select to authenticated using (private.is_hr(org_id) or private.can_access_candidate(id));
create policy "hr update candidates" on public.candidates
  for update to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

create policy "read accessible candidate files" on public.candidate_files
  for select to authenticated using (private.is_hr(org_id) or private.can_access_candidate(candidate_id));

-- applications: hiring managers read; only HR moves stages (HMs request changes)
create policy "read accessible applications" on public.applications
  for select to authenticated using (private.is_hr(org_id) or private.is_assigned_hm(job_id));
create policy "hr update applications" on public.applications
  for update to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

create policy "read stage history" on public.stage_history
  for select to authenticated using (private.can_access_application(application_id));

-- notes
create policy "read notes" on public.notes
  for select to authenticated using (private.can_access_application(application_id));
create policy "write own notes" on public.notes
  for insert to authenticated
  with check (author_id = (select auth.uid()) and private.can_access_application(application_id));
create policy "edit own notes" on public.notes
  for update to authenticated
  using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy "delete own notes" on public.notes
  for delete to authenticated using (author_id = (select auth.uid()));

-- notifications: own only
create policy "read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own notifications read" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- templates and automations
create policy "members read templates" on public.message_templates
  for select to authenticated using (private.is_org_member(org_id));
create policy "hr manage templates" on public.message_templates
  for all to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

create policy "hr read automations" on public.automation_rules
  for select to authenticated using (private.is_hr(org_id));
create policy "hr manage automations" on public.automation_rules
  for all to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

-- messages: visible with the application; HR may queue or cancel
create policy "read messages" on public.messages
  for select to authenticated using (private.can_access_application(application_id));
create policy "hr queue messages" on public.messages
  for insert to authenticated
  with check (private.is_hr(org_id) and status = 'queued' and created_by = (select auth.uid()));
create policy "hr cancel messages" on public.messages
  for update to authenticated
  using (private.is_hr(org_id) and status = 'queued')
  with check (private.is_hr(org_id) and status = 'cancelled');

-- PDPA
create policy "members read consent notices" on public.consent_notices
  for select to authenticated using (private.is_org_member(org_id));
create policy "admins manage consent notices" on public.consent_notices
  for insert to authenticated
  with check (private.has_org_role(org_id, array['admin']::public.member_role[]));

create policy "hr read consent records" on public.consent_records
  for select to authenticated using (private.is_hr(org_id));

create policy "hr read data requests" on public.data_requests
  for select to authenticated using (private.is_hr(org_id));
create policy "hr handle data requests" on public.data_requests
  for update to authenticated using (private.is_hr(org_id)) with check (private.is_hr(org_id));

-- analytics and audit
create policy "hr read job views" on public.job_views
  for select to authenticated using (private.is_hr(org_id));
create policy "admins read audit log" on public.audit_log
  for select to authenticated
  using (private.has_org_role(org_id, array['admin']::public.member_role[]));

-- =============================================================================
-- Storage: private resume bucket. No client policies — every read goes through
-- the server, which checks access, writes the audit log and returns a
-- short-lived signed URL (PRD §13).
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760,
        array['application/pdf',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Realtime for the pipeline board (HR-06: visible to other HR users)
alter publication supabase_realtime add table public.applications;
