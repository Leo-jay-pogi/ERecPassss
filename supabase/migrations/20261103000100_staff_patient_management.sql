-- Staff patient management: expose a narrowly scoped, role-checked update RPC.
-- Staff cannot use this function unless both the active profile and Staff row match auth.uid().
create or replace function public.staff_update_patient_record(
  p_patient_id uuid,
  p_status text,
  p_birth_date date,
  p_guardian_num text,
  p_doctor_notes text,
  p_lab_results jsonb,
  p_prescriptions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_patient jsonb;
  v_age integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join public.staff as staff_account on staff_account.user_id = profile.id
    where profile.id = auth.uid()
      and lower(coalesce(profile.role, '')) = 'staff'
      and profile.active is true
      and staff_account.active is true
  ) then
    raise exception 'An active Staff account is required.' using errcode = '42501';
  end if;

  if p_patient_id is null then
    raise exception 'Patient ID is required.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('Green', 'Yellow', 'Red') then
    raise exception 'Invalid patient health status.' using errcode = '22023';
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'Date of birth cannot be in the future.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_lab_results, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_prescriptions, '[]'::jsonb)) <> 'array' then
    raise exception 'Laboratory results and prescriptions must be JSON arrays.' using errcode = '22023';
  end if;

  v_age := case
    when p_birth_date is null then null
    else extract(year from age(current_date, p_birth_date))::integer
  end;

  update public.patients as patient
  set status = p_status,
      birth_date = p_birth_date,
      age = v_age,
      age_category = case
        when p_birth_date is null then coalesce(nullif(patient.age_category, ''), 'Adult')
        when v_age <= 17 then 'Minor'
        else 'Adult'
      end,
      guardian_num = nullif(btrim(coalesce(p_guardian_num, '')), ''),
      doctor_notes = nullif(btrim(coalesce(p_doctor_notes, '')), ''),
      lab_results = coalesce(p_lab_results, '[]'::jsonb),
      prescriptions = coalesce(p_prescriptions, '[]'::jsonb)
  where patient.id = p_patient_id
  returning to_jsonb(patient) into v_patient;

  if v_patient is null then
    raise exception 'Patient record was not found.' using errcode = 'P0002';
  end if;

  return v_patient;
end;
$$;

revoke all on function public.staff_update_patient_record(uuid, text, date, text, text, jsonb, jsonb) from public;
revoke all on function public.staff_update_patient_record(uuid, text, date, text, text, jsonb, jsonb) from anon;
grant execute on function public.staff_update_patient_record(uuid, text, date, text, text, jsonb, jsonb) to authenticated;

comment on function public.staff_update_patient_record(uuid, text, date, text, text, jsonb, jsonb)
is 'Allows active Staff accounts to update the approved patient-management fields after server-side role validation.';
