begin;

-- Reuse the existing Nurse assignment checks and notifications, then save an
-- optional proposed time in the same transaction.
create or replace function public.nurse_assign_appointment_with_time(
  p_appointment_id bigint,
  p_doctor_staff_id text,
  p_proposed_time time default null,
  p_reason text default ''
) returns public.appointments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated public.appointments%rowtype;
  v_schedule public.staff_availability%rowtype;
  v_booked integer;
  v_duration integer;
begin
  select public.nurse_assign_appointment(p_appointment_id, p_doctor_staff_id, p_reason)
    into v_updated;

  if p_proposed_time is null then
    return v_updated;
  end if;

  if not exists (
    select 1 from public.get_available_appointment_slots(p_doctor_staff_id, v_updated.appointment_date) slot
    where slot.appointment_time = p_proposed_time
  ) then
    raise exception 'That time is no longer available for this Doctor. Refresh and choose another time.' using errcode = '23P01';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_doctor_staff_id || '|' || v_updated.appointment_date::text, 0));
  select * into v_schedule from public.staff_availability
  where staff_id = p_doctor_staff_id
    and day_of_week = extract(dow from v_updated.appointment_date)::smallint
    and is_available = true;
  v_duration := coalesce(v_updated.appointment_duration_minutes, v_schedule.appointment_duration_minutes, 30);

  select count(*) into v_booked from public.appointments a
  where a.id <> v_updated.id
    and a.provider_staff_id = p_doctor_staff_id
    and a.appointment_date = v_updated.appointment_date
    and a.appointment_time = p_proposed_time
    and lower(btrim(a.status)) in ('assigned', 'pending', 'pending approval', 'approved');
  if v_booked >= coalesce(v_schedule.max_appointments_per_slot, 1) then
    raise exception 'That time is full. Refresh and choose another time.' using errcode = '23P01';
  end if;
  if exists (
    select 1 from public.appointments a
    where a.id <> v_updated.id
      and a.provider_staff_id = p_doctor_staff_id
      and a.appointment_date = v_updated.appointment_date
      and a.appointment_time is not null
      and a.appointment_time <> p_proposed_time
      and lower(btrim(a.status)) in ('assigned', 'pending', 'pending approval', 'approved')
      and a.appointment_time < p_proposed_time + make_interval(mins => v_duration)
      and a.appointment_time + make_interval(mins => coalesce(a.appointment_duration_minutes, v_duration)) > p_proposed_time
  ) then
    raise exception 'That time overlaps another appointment. Refresh and choose another time.' using errcode = '23P01';
  end if;

  update public.appointments set appointment_time = p_proposed_time
  where id = v_updated.id returning * into v_updated;

  insert into public.appointment_audit_logs(
    appointment_id, changed_by, changed_by_role, previous_status, new_status, action, reason,
    previous_doctor_staff_id, new_doctor_staff_id, details
  ) values (
    v_updated.id, auth.uid(), 'nurse', 'Assigned', 'Assigned', 'nurse_proposed_time',
    'Nurse proposed ' || to_char(p_proposed_time, 'FMHH12:MI AM') || ' Manila time.',
    v_updated.provider_staff_id, v_updated.provider_staff_id,
    jsonb_build_object('proposed_time', p_proposed_time, 'doctor_verification_required', true)
  );
  return v_updated;
end;
$$;
revoke all on function public.nurse_assign_appointment_with_time(bigint, text, time, text) from public, anon;
grant execute on function public.nurse_assign_appointment_with_time(bigint, text, time, text) to authenticated;

commit;
