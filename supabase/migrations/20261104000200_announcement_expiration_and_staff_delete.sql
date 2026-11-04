begin;

alter table public.announcements
  add column if not exists expires_at timestamptz;

create policy announcements_active_staff_delete_own
on public.announcements
for delete
to authenticated
using (
  created_by = auth.uid()
  and exists (
    select 1
    from public.profiles as profile
    join public.staff as staff_account on staff_account.user_id = profile.id
    where profile.id = auth.uid()
      and lower(coalesce(profile.role, '')) = 'staff'
      and profile.active is true
      and staff_account.active is true
  )
);

commit;
