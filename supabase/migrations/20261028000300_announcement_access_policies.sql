-- Let signed-in patients and staff read hospital announcements.
-- Only an active Supabase Admin may create, update, or delete them.
alter table public.announcements enable row level security;

drop policy if exists erecpass_authenticated_read_announcements on public.announcements;
create policy erecpass_authenticated_read_announcements
  on public.announcements
  for select
  to authenticated
  using (true);

drop policy if exists erecpass_active_admin_manage_announcements on public.announcements;
create policy erecpass_active_admin_manage_announcements
  on public.announcements
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and p.active is true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and p.active is true
    )
  );
