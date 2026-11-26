-- AP-05: candidates' data access / correction / deletion requests (PDPA).

alter table public.data_requests
  -- Email verification of the request (hash of the link's token).
  add column token_hash         text unique,
  add column token_expires_at   timestamptz,
  -- Time-limited download link for an access/export request.
  add column export_token_hash  text unique,
  add column export_expires_at  timestamptz,
  -- What HR did, or why the request was declined. Sent to the candidate.
  add column resolution         text check (length(resolution) <= 2000);

create index data_requests_email_idx on public.data_requests(org_id, email, created_at desc);

-- Requests are created by the server for anonymous candidates; HR may only
-- change how a request was handled.
revoke insert, update, delete on public.data_requests from authenticated;
grant update (status, handled_by, handled_at, resolution) on public.data_requests to authenticated;

-- Deletes a candidate and everything about them, for a verified deletion
-- request. Returns the storage paths of their files so the server can remove
-- the bytes. Applications, files, notes, messages, stage history and consent
-- records go by cascade; notifications that quote them are removed here.
create or replace function public.erase_candidate(p_request uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_req   public.data_requests;
  v_paths text[];
begin
  select * into v_req from public.data_requests where id = p_request for update;
  if not found or not private.is_hr(v_req.org_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_req.kind <> 'delete' or v_req.status <> 'open' then
    raise exception 'Only open deletion requests can erase data' using errcode = 'MC422';
  end if;

  v_paths := '{}';
  if v_req.candidate_id is not null then
    select coalesce(array_agg(p), '{}') into v_paths from (
      select storage_path as p from public.candidate_files where candidate_id = v_req.candidate_id
      union all
      select preview_path from public.candidate_files where candidate_id = v_req.candidate_id and preview_path is not null
    ) f;

    delete from public.notifications
     where org_id = v_req.org_id and payload->>'candidate_id' = v_req.candidate_id::text;
    delete from public.candidates where id = v_req.candidate_id and org_id = v_req.org_id;

    insert into public.audit_log(org_id, actor_id, action, entity, entity_id, metadata)
    values (v_req.org_id, (select auth.uid()), 'candidate.erase', 'candidate', v_req.candidate_id::text,
            jsonb_build_object('request_id', p_request, 'files', coalesce(array_length(v_paths, 1), 0)));
  end if;

  update public.data_requests
     set status = 'completed', handled_by = (select auth.uid()), handled_at = now(),
         resolution = coalesce(resolution, 'All personal data held about you has been deleted.')
   where id = p_request;

  return v_paths;
end $$;
revoke execute on function public.erase_candidate(uuid) from public, anon;
grant execute on function public.erase_candidate(uuid) to authenticated;
