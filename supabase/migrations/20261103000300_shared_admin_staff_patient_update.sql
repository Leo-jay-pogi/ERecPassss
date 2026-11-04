begin;

drop function if exists public.staff_update_patient_record(text, text, date, text, text, jsonb, jsonb);

create or replace function public.admin_staff_update_patient_record(
  p_patient_id text,
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
  v_current_prescriptions jsonb;
  v_is_admin boolean;
  v_is_staff boolean;
  v_is_doctor boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '28000';
  end if;

  select
    profile.role = 'admin' and profile.active is true,
    profile.role = 'staff' and profile.active is true
      and staff_account.active is true,
    profile.role = 'staff' and profile.active is true
      and staff_account.active is true
      and staff_account.account_type = 'doctor'
  into v_is_admin, v_is_staff, v_is_doctor
  from public.profiles as profile
  left join public.staff as staff_account on staff_account.user_id = profile.id
  where profile.id = auth.uid();

  if not coalesce(v_is_admin, false) and not coalesce(v_is_staff, false) then
    raise exception 'An active Admin or Staff account is required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_patient_id), '') is null then
    raise exception 'Patient ID is required.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('Green', 'Yellow', 'Red') then
    raise exception 'Invalid patient health status.' using errcode = '22023';
  end if;
  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'Date of birth cannot be in the future.' using errcode = '22023';
  end if;
  if length(coalesce(p_guardian_num, '')) > 40 then
    raise exception 'Guardian contact number must be 40 characters or fewer.' using errcode = '22023';
  end if;
  if length(coalesce(p_doctor_notes, '')) > 4000 then
    raise exception 'Doctor notes must be 4,000 characters or fewer.' using errcode = '22023';
  end if;
  if p_lab_results is null or jsonb_typeof(p_lab_results) <> 'array'
     or p_prescriptions is null or jsonb_typeof(p_prescriptions) <> 'array' then
    raise exception 'Laboratory results and prescriptions must be JSON arrays.' using errcode = '22023';
  end if;

  select coalesce(patient.prescriptions, '[]'::jsonb)
  into v_current_prescriptions
  from public.patients as patient
  where patient.id = p_patient_id
  for update;
  if not found then
    raise exception 'Patient record was not found.' using errcode = 'P0002';
  end if;
  if p_prescriptions is distinct from v_current_prescriptions
     and not coalesce(v_is_admin, false)
     and not coalesce(v_is_doctor, false) then
    raise exception 'Only an active Admin or Doctor can update patient prescriptions.' using errcode = '42501';
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
      lab_results = p_lab_results,
      prescriptions = p_prescriptions
  where patient.id = p_patient_id
  returning jsonb_build_object(
    'id', patient.id,
    'status', patient.status,
    'birth_date', patient.birth_date,
    'age', patient.age,
    'age_category', patient.age_category,
    'guardian_num', patient.guardian_num,
    'doctor_notes', patient.doctor_notes,
    'lab_results', patient.lab_results,
    'prescriptions', patient.prescriptions
  )
  into v_patient;

  if v_patient is null then
    raise exception 'Patient record was not found.' using errcode = 'P0002';
  end if;

  return v_patient;
end;
$$;

revoke all on function public.admin_staff_update_patient_record(text, text, date, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.admin_staff_update_patient_record(text, text, date, text, text, jsonb, jsonb) to authenticated;

comment on function public.admin_staff_update_patient_record(text, text, date, text, text, jsonb, jsonb)
is 'Shared patient-record update for active Admin and Staff accounts, with Doctor/Admin-only prescription edits.';

commit;
