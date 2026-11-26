-- Team invitations (PRD §3: Org Admin manages users) and safeguards on members.

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  email        text not null check (email = lower(email) and position('@' in email) > 1),
  role         public.member_role not null,
  -- SHA-256 of the token in the emailed link; the token itself is never stored.
  token_hash   text not null unique,
  invited_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz
);
-- One open invitation per person per organisation.
create unique index invitations_open_uq on public.invitations(org_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.invitations enable row level security;
grant select, insert on public.invitations to authenticated;
grant update (revoked_at) on public.invitations to authenticated;
grant all on public.invitations to service_role;

create policy "admins read invitations" on public.invitations
  for select to authenticated
  using (private.has_org_role(org_id, array['admin']::public.member_role[]));
create policy "admins create invitations" on public.invitations
  for insert to authenticated
  with check (private.has_org_role(org_id, array['admin']::public.member_role[])
              and invited_by = (select auth.uid()) and accepted_at is null and revoked_at is null);
create policy "admins revoke invitations" on public.invitations
  for update to authenticated
  using (private.has_org_role(org_id, array['admin']::public.member_role[]) and accepted_at is null)
  with check (private.has_org_role(org_id, array['admin']::public.member_role[]));

-- Members join only through create_organisation or accept_invitation, and
-- admins may change nothing but a member's role.
revoke insert, update on public.members from authenticated;
grant update (role) on public.members to authenticated;

-- An organisation always keeps at least one admin (except when the whole
-- organisation is being deleted).
create or replace function private.members_keep_an_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and exists (select 1 from public.organisations where id = old.org_id)
     and not exists (select 1 from public.members
                      where org_id = old.org_id and role = 'admin' and user_id <> old.user_id) then
    raise exception 'An organisation needs at least one admin' using errcode = 'MC409';
  end if;
  return coalesce(new, old);
end $$;
create trigger members_keep_an_admin before update of role or delete on public.members
  for each row execute function private.members_keep_an_admin();

-- Accepting an invitation. The caller passes the hash of the link's token.
-- Error codes: MC401 invalid/revoked, MC402 used, MC403 expired,
-- MC404 signed in with another email, MC405 already in another organisation.
create or replace function public.accept_invitation(p_token_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_inv   public.invitations;
  v_email text;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_inv from public.invitations where token_hash = p_token_hash for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'Invitation not found' using errcode = 'MC401';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invitation already used' using errcode = 'MC402';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Invitation expired' using errcode = 'MC403';
  end if;

  select lower(u.email), coalesce(u.raw_user_meta_data->>'full_name', '')
    into v_email, v_name from auth.users u where u.id = v_uid;
  if v_email is distinct from v_inv.email then
    raise exception 'Invitation is for another email address' using errcode = 'MC404';
  end if;
  -- One organisation per account until the app has an organisation switcher.
  if exists (select 1 from public.members where user_id = v_uid and org_id <> v_inv.org_id) then
    raise exception 'Account already belongs to another organisation' using errcode = 'MC405';
  end if;

  insert into public.members(org_id, user_id, role, full_name, email)
  values (v_inv.org_id, v_uid, v_inv.role, v_name, v_email)
  on conflict (org_id, user_id) do nothing;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.org_id;
end $$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;
