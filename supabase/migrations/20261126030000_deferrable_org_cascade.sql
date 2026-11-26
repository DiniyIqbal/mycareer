-- Deleting an organisation cascades to both pipeline_stages and applications
-- (and to both consent_notices and consent_records). Postgres may delete the
-- stage / notice first, and these plain foreign keys then fail even though the
-- referencing rows are about to be deleted too. Checking them at commit fixes
-- that, while still refusing to delete a stage or notice that is in use.

alter table public.applications
  alter constraint applications_org_id_stage_id_fkey deferrable initially deferred;

alter table public.consent_records
  alter constraint consent_records_org_id_notice_id_fkey deferrable initially deferred;
