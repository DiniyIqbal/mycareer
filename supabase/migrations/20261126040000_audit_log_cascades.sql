-- audit_log stays append-only, with two exceptions that come from foreign
-- key cascades rather than from anyone editing history:
--   1. Deleting an organisation deletes its log (the tenant is gone, and with
--      it the personal data the log refers to).
--   2. Deleting a user account sets actor_id to null (ON DELETE SET NULL);
--      nothing else on the row may change.
-- Before this, both cascades were blocked, so neither an organisation with
-- any logged activity nor an HR user who had viewed a resume could be deleted.

create or replace function private.audit_log_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.organisations where id = old.org_id) then
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.actor_id is not null and new.actor_id is null
     and not exists (select 1 from auth.users where id = old.actor_id)
     and (new.id, new.org_id, new.action, new.entity, new.entity_id, new.metadata, new.created_at)
         is not distinct from
         (old.id, old.org_id, old.action, old.entity, old.entity_id, old.metadata, old.created_at) then
    return new;
  end if;

  raise exception 'audit_log is append-only';
end $$;
