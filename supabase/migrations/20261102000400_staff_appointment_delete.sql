begin;

create or replace function public.staff_delete_assigned_appointment(p_appointment_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_staff_id text;
  v_deleted_id bigint;
begin
  select s.id into v_staff_id
  from public.staff s
  join public.profiles p on p.id = s.user_id
  where s.user_id = auth.uid()
    and p.role = 'staff' and p.active is true and s.active is true;
  if v_staff_id is null then
    raise exception 'Active Staff access is required.' using errcode = '42501';
  end if;

  delete from public.appointments a
  where a.id = p_appointment_id
    and (a.provider_staff_id = v_staff_id or a.assigned_nurse_id = auth.uid())
  returning a.id into v_deleted_id;
  if v_deleted_id is null then
    raise exception 'Appointment not found or not assigned to your Staff account.' using errcode = 'P0002';
  end if;
  return v_deleted_id;
end;
$$;
revoke all on function public.staff_delete_assigned_appointment(bigint) from public, anon;
grant execute on function public.staff_delete_assigned_appointment(bigint) to authenticated;

commit;
