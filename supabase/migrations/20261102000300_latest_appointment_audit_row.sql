begin;

-- Keep only the latest existing audit entry for each appointment before enforcing
-- the one-row-per-appointment behavior.
with ranked as (
  select id, row_number() over (
    partition by appointment_id
    order by created_at desc, id desc
  ) as row_num
  from public.appointment_audit_logs
  where appointment_id is not null
)
delete from public.appointment_audit_logs al
using ranked r
where al.id = r.id and r.row_num > 1;

-- Incoming audit writes replace the existing appointment row's contents. The
-- previous row ID stays stable, so foreign references to it remain valid.
create or replace function public.keep_latest_appointment_audit_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_id bigint;
begin
  if new.appointment_id is null then
    return new;
  end if;

  select id into v_existing_id
  from public.appointment_audit_logs
  where appointment_id = new.appointment_id
    and id <> new.id
  order by created_at desc, id desc
  limit 1
  for update;

  if v_existing_id is null then
    return new;
  end if;

  update public.appointment_audit_logs
  set changed_by = new.changed_by,
      changed_by_role = new.changed_by_role,
      previous_status = new.previous_status,
      new_status = new.new_status,
      action = new.action,
      reason = new.reason,
      previous_doctor_staff_id = new.previous_doctor_staff_id,
      new_doctor_staff_id = new.new_doctor_staff_id,
      details = new.details,
      created_at = new.created_at
  where id = v_existing_id;

  delete from public.appointment_audit_logs where id = new.id;
  return null;
end;
$$;
revoke all on function public.keep_latest_appointment_audit_row() from public, anon, authenticated;
drop trigger if exists keep_latest_appointment_audit_row on public.appointment_audit_logs;
create trigger keep_latest_appointment_audit_row
  after insert on public.appointment_audit_logs
  for each row execute function public.keep_latest_appointment_audit_row();

create index if not exists appointment_audit_logs_latest_idx
  on public.appointment_audit_logs(appointment_id, created_at desc);

commit;
