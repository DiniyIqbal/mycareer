-- Data retention (PRD §13 / privacy notice): candidate data is deleted a set
-- number of months after the last role they applied for closed.

alter table public.organisations
  add column retention_months int not null default 12 check (retention_months between 1 and 120);

-- When a job stopped taking applications. Set on close/archive, cleared on
-- reopen; backfilled from updated_at for jobs already closed.
alter table public.jobs add column closed_at timestamptz;
update public.jobs set closed_at = updated_at where status in ('closed', 'archived');

create or replace function private.jobs_track_closed_at()
returns trigger language plpgsql as $$
begin
  if new.status in ('closed', 'archived') then
    if old.status not in ('closed', 'archived') or new.closed_at is null then
      new.closed_at := coalesce(new.closed_at, now());
    end if;
  else
    new.closed_at := null;
  end if;
  return new;
end $$;
create trigger jobs_track_closed_at before update of status on public.jobs
  for each row execute function private.jobs_track_closed_at();

-- When each candidate's data falls due for deletion. A job counts as ended
-- when it is closed/archived or its closing date has passed; a candidate
-- with any application to a job that has not ended is kept (no row).
-- Candidates with no applications left are measured from when they joined.
create or replace function private.candidate_retention()
returns table (org_id uuid, candidate_id uuid, delete_after timestamptz)
language sql stable security definer set search_path = '' as $$
  with ends as (
    select c.org_id, c.id as candidate_id, c.created_at,
           count(a.id) as apps,
           bool_or(a.id is not null and
                   case when j.status in ('closed', 'archived') then false
                        when j.closes_at is not null and j.closes_at < now() then false
                        else true end) as any_open,
           max(case when j.status in ('closed', 'archived') then coalesce(j.closed_at, j.updated_at)
                    when j.closes_at is not null and j.closes_at < now() then j.closes_at end) as last_end
      from public.candidates c
      left join public.applications a on a.candidate_id = c.id
      left join public.jobs j on j.id = a.job_id
     group by c.org_id, c.id, c.created_at
  )
  select e.org_id, e.candidate_id,
         (case when e.apps = 0 then e.created_at else e.last_end end)
           + make_interval(months => o.retention_months)
    from ends e
    join public.organisations o on o.id = e.org_id
   where not coalesce(e.any_open, false);
$$;
revoke execute on function private.candidate_retention() from public, anon, authenticated;

-- HR view of the schedule for their organisation (Settings → Privacy, profile).
create or replace function public.candidate_retention_schedule(p_org uuid)
returns table (candidate_id uuid, delete_after timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr(p_org) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select r.candidate_id, r.delete_after from private.candidate_retention() r where r.org_id = p_org;
end $$;
revoke execute on function public.candidate_retention_schedule(uuid) from public, anon;
grant execute on function public.candidate_retention_schedule(uuid) to authenticated;

-- The daily job. Deletes up to p_limit candidates whose time is up and
-- returns their resume paths so the server can delete the files. Service
-- role only.
create or replace function public.purge_expired_candidates(p_limit int default 200)
returns table (org_id uuid, candidate_id uuid, paths text[])
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select x.org_id, x.candidate_id, x.delete_after
      from private.candidate_retention() x
     where x.delete_after < now()
     order by x.delete_after
     limit greatest(1, least(p_limit, 1000))
  loop
    select coalesce(array_agg(p), '{}') into paths from (
      select f.storage_path as p from public.candidate_files f where f.candidate_id = r.candidate_id
      union all
      select f.preview_path from public.candidate_files f where f.candidate_id = r.candidate_id and f.preview_path is not null
    ) s;

    delete from public.notifications n
     where n.org_id = r.org_id and n.payload->>'candidate_id' = r.candidate_id::text;
    delete from public.candidates c where c.id = r.candidate_id;

    insert into public.audit_log(org_id, actor_id, action, entity, entity_id, metadata)
    values (r.org_id, null, 'candidate.retention_delete', 'candidate', r.candidate_id::text,
            jsonb_build_object('due', r.delete_after, 'files', coalesce(array_length(paths, 1), 0)));

    org_id := r.org_id;
    candidate_id := r.candidate_id;
    return next;
  end loop;
end $$;
revoke execute on function public.purge_expired_candidates(int) from public, anon, authenticated;
grant execute on function public.purge_expired_candidates(int) to service_role;
