begin;

create or replace function public.permanently_delete_appointment_backup(p_backup_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.active is true
  ) then
    raise exception 'Active admin access is required.' using errcode = '42501';
  end if;
  delete from public.appointment_deletion_backups where id = p_backup_id;
  if not found then raise exception 'Appointment backup not found.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.permanently_delete_appointment_backup(bigint) from public, anon;
grant execute on function public.permanently_delete_appointment_backup(bigint) to authenticated;

create or replace function public.permanently_delete_emergency_alert_backup(p_backup_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.active is true
  ) then
    raise exception 'Active admin access is required.' using errcode = '42501';
  end if;
  delete from public.emergency_alert_deletion_backups where id = p_backup_id;
  if not found then raise exception 'GPS alert backup not found.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.permanently_delete_emergency_alert_backup(bigint) from public, anon;
grant execute on function public.permanently_delete_emergency_alert_backup(bigint) to authenticated;

commit;
