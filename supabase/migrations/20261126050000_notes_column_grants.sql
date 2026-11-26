-- HR-07. The "edit own notes" and "mark own notifications read" policies only
-- check who owns the row, so with table-wide UPDATE a user could re-point a
-- note at another application (or another organisation's) or rewrite a
-- notification. Limit updates to the columns those features need.

revoke update on public.notes from authenticated;
grant update (body, mentions) on public.notes to authenticated;

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- Notifications are created by the server after it has checked who may see
-- the candidate; signed-in users never insert them directly.
revoke insert, delete on public.notifications from authenticated;

-- Pages list a user's unread notifications.
create index if not exists notifications_unread_idx
  on public.notifications(user_id, created_at desc) where read_at is null;
