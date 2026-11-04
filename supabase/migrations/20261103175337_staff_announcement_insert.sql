begin;

create policy announcements_active_staff_insert
on public.announcements
for insert
to authenticated
with check (
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
