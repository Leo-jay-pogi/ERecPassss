begin;

drop policy if exists patients_update_staff_admin on public.patients;
create policy patients_update_staff_admin
  on public.patients
  for update
  to authenticated
  using (app_private.has_role('admin'))
  with check (app_private.has_role('admin'));

comment on policy patients_update_staff_admin on public.patients
is 'Direct patient updates are Admin-only; active Doctors and Nurses use the role-checked update RPC.';

commit;
