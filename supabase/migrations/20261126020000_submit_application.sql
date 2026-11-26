-- AP-03 / AP-04: public job application, written in one transaction.
--
-- Called only by the Next.js server (service role) after it has validated the
-- form and uploaded the resume to the private `resumes` bucket. Everything
-- else (candidate, file metadata, application, PDPA consent record, queued
-- confirmation email) is created here so a failure leaves nothing behind.

create or replace function public.submit_application(
  p_job_id     uuid,
  p_email      text,
  p_full_name  text,
  p_phone      text,
  p_timezone   text,
  p_locale     text,
  p_source     text,
  p_answers    jsonb,
  p_notice_id  uuid,
  p_file_path  text,
  p_file_name  text,
  p_file_mime  text,
  p_file_size  int
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email     text := lower(trim(p_email));
  v_org       uuid;
  v_purpose   text;
  v_stage     uuid;
  v_candidate uuid;
  v_file      uuid;
  v_app       uuid;
  v_message   uuid;
begin
  select org_id into v_org from public.jobs where id = p_job_id;
  if v_org is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  -- The notice the applicant saw must belong to this organisation.
  select purpose into v_purpose from public.consent_notices
   where id = p_notice_id and org_id = v_org;
  if v_purpose is distinct from 'application' then
    raise exception 'Invalid consent notice' using errcode = '22023';
  end if;

  select id into v_stage from public.pipeline_stages where org_id = v_org and kind = 'new';

  -- A returning candidate keeps their existing profile: a public form must not
  -- let anyone overwrite another person's name or phone by typing their email.
  insert into public.candidates(org_id, email, full_name, phone, timezone, locale)
  values (v_org, v_email, trim(p_full_name), nullif(trim(p_phone), ''),
          nullif(p_timezone, ''), coalesce(p_locale, 'en'))
  on conflict (org_id, email) do update
     set timezone = coalesce(public.candidates.timezone, excluded.timezone)
  returning id into v_candidate;

  insert into public.candidate_files(org_id, candidate_id, kind, storage_path, original_name, mime_type, size_bytes)
  values (v_org, v_candidate, 'resume', p_file_path, left(p_file_name, 255), p_file_mime, p_file_size)
  returning id into v_file;

  -- The insert guard trigger rejects closed / draft / expired jobs, and
  -- unique (job_id, candidate_id) rejects a second application (23505).
  insert into public.applications(org_id, job_id, candidate_id, stage_id, resume_file_id, source, answers)
  values (v_org, p_job_id, v_candidate, v_stage, v_file,
          coalesce(nullif(p_source, ''), 'careers_page'), coalesce(p_answers, '{}'::jsonb))
  returning id into v_app;

  insert into public.consent_records(org_id, candidate_id, application_id, notice_id, purpose)
  values (v_org, v_candidate, v_app, p_notice_id, 'application');

  -- Confirmation is transactional, so it ignores quiet hours (AP-04).
  insert into public.messages(org_id, application_id, channel, template_key, to_address, respect_quiet_hours)
  values (v_org, v_app, 'email', 'application_received', v_email, false)
  returning id into v_message;

  return jsonb_build_object('application_id', v_app, 'message_id', v_message, 'org_id', v_org);
end $$;

revoke execute on function public.submit_application(uuid, text, text, text, text, text, text, jsonb, uuid, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.submit_application(uuid, text, text, text, text, text, text, jsonb, uuid, text, text, text, int)
  to service_role;
