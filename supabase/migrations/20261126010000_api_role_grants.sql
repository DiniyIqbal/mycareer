-- New Supabase projects do not grant table privileges to the API roles by
-- default. Grant them explicitly; row-level security still decides which
-- rows each user can see or change.
--
-- Every future migration that creates a table must add its grants here-style
-- (and enable RLS), or the Data API will return "permission denied".

grant usage on schema public to anon, authenticated, service_role;

-- Server-side code (service role) bypasses RLS and needs full access.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all routines  in schema public to service_role;

-- Signed-in users: table access, filtered by RLS policies.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Defence in depth: history and audit rows are written only by triggers or the
-- server, never directly by a signed-in user.
revoke insert, update, delete on public.audit_log     from authenticated;
revoke insert, update, delete on public.stage_history from authenticated;
revoke insert, update, delete on public.job_views     from authenticated;
revoke insert, update, delete on public.consent_records from authenticated;

-- Anonymous visitors keep only the column grants from the schema migration
-- (public organisation columns, published jobs, consent notices).
