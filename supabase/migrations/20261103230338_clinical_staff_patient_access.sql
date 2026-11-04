-- Restrict Staff patient access to active Doctors and Nurses.
begin;

create or replace function app_private.is_clinical_staff()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    join public.staff as staff_account on staff_account.user_id = profile.id
    where profile.id = (select auth.uid())
      and lower(coalesce(profile.role, '')) = 'staff'
      and profile.active is true
      and staff_account.active is true
      and lower(coalesce(staff_account.account_type, '')) in ('doctor', 'nurse')
  );
$$;

grant usage on schema app_private to authenticated;
revoke all on function app_private.is_clinical_staff() from public, anon;
grant execute on function app_private.is_clinical_staff() to authenticated;

drop policy if exists patients_select_owner_or_staff on public.patients;
create policy patients_select_owner_or_staff
  on public.patients
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or app_private.has_role('admin')
    or app_private.is_clinical_staff()
  );

drop policy if exists patients_update_staff_admin on public.patients;
create policy patients_update_staff_admin
  on public.patients
  for update
  to authenticated
  using (
    app_private.has_role('admin')
    or app_private.is_clinical_staff()
  )
  with check (
    app_private.has_role('admin')
    or app_private.is_clinical_staff()
  );

create or replace function public.staff_list_patients(p_search text default '')
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_patients jsonb;
  v_search text := lower(btrim(coalesce(p_search, '')));
begin
  if auth.uid() is null or not app_private.is_clinical_staff() then
    raise exception 'An active Doctor or Nurse account is required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', patient.id,
        'full_name', patient.full_name,
        'email', patient.email,
        'guardian_num', patient.guardian_num,
        'status', patient.status
      )
      order by patient.full_name, patient.id
    ),
    '[]'::jsonb
  )
  into v_patients
  from public.patients as patient
  where v_search = ''
     or position(
       v_search in lower(concat_ws(
         ' ',
         patient.id,
         patient.full_name,
         patient.email,
         patient.status,
         patient.guardian_num
       ))
     ) > 0;

  return v_patients;
end;
$$;

create or replace function public.staff_get_patient_record(p_patient_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_patient jsonb;
begin
  if auth.uid() is null or not app_private.is_clinical_staff() then
    raise exception 'An active Doctor or Nurse account is required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_patient_id), '') is null then
    raise exception 'Patient ID is required.' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'id', patient.id,
    'full_name', patient.full_name,
    'email', patient.email,
    'status', patient.status,
    'birth_date', patient.birth_date,
    'age', patient.age,
    'age_category', patient.age_category,
    'guardian_num', patient.guardian_num,
    'doctor_notes', patient.doctor_notes,
    'lab_results', coalesce(patient.lab_results, '[]'::jsonb),
    'prescriptions', coalesce(patient.prescriptions, '[]'::jsonb),
    'can_edit_prescriptions', exists (
      select 1
      from public.staff as staff_account
      where staff_account.user_id = auth.uid()
        and staff_account.active is true
        and lower(coalesce(staff_account.account_type, '')) = 'doctor'
    )
  )
  into v_patient
  from public.patients as patient
  where patient.id = p_patient_id;

  if v_patient is null then
    raise exception 'Patient record was not found.' using errcode = 'P0002';
  end if;

  return v_patient;
end;
$$;

create or replace function public.staff_update_patient_record(
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
begin
  if auth.uid() is null or not app_private.is_clinical_staff() then
    raise exception 'An active Doctor or Nurse account is required.' using errcode = '42501';
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
     and not exists (
       select 1
       from public.staff as staff_account
       where staff_account.user_id = auth.uid()
         and staff_account.active is true
         and lower(coalesce(staff_account.account_type, '')) = 'doctor'
     ) then
    raise exception 'Only an active Doctor can update patient prescriptions.' using errcode = '42501';
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
    app_private.is_clinical_staff(),
    profile.role = 'staff' and profile.active is true
      and staff_account.active is true
      and lower(coalesce(staff_account.account_type, '')) = 'doctor'
  into v_is_admin, v_is_staff, v_is_doctor
  from public.profiles as profile
  left join public.staff as staff_account on staff_account.user_id = profile.id
  where profile.id = auth.uid();

  if not coalesce(v_is_admin, false) and not coalesce(v_is_staff, false) then
    raise exception 'An active Admin, Doctor, or Nurse account is required.' using errcode = '42501';
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
      guardian_num = coalesce(nullif(btrim(coalesce(p_guardian_num, '')), ''), ''),
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

create or replace function public.staff_list_patient_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_accounts jsonb;
begin
  if auth.uid() is null or not app_private.is_clinical_staff() then
    raise exception 'An active Doctor or Nurse account is required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'patient_id', patient.id,
        'full_name', patient.full_name,
        'email', patient.email,
        'account_linked', (
          patient.user_id is not null
          and auth_user.id is not null
          and coalesce(patient_profile.role, '') = 'patient'
        ),
        'account_active', (
          patient.user_id is not null
          and auth_user.id is not null
          and coalesce(patient_profile.role, '') = 'patient'
          and coalesce(patient.active, false)
          and coalesce(patient_profile.active, false)
        ),
        'email_verified', case
          when auth_user.id is not null and coalesce(patient_profile.role, '') = 'patient'
            then auth_user.email_confirmed_at is not null
          else null
        end
      )
      order by patient.full_name, patient.id
    ),
    '[]'::jsonb
  )
  into v_accounts
  from public.patients as patient
  left join auth.users as auth_user on auth_user.id = patient.user_id
  left join public.profiles as patient_profile on patient_profile.id = patient.user_id;

  return v_accounts;
end;
$$;

comment on function app_private.is_clinical_staff()
is 'Returns whether the authenticated user is an active Doctor or Nurse.';
comment on function public.staff_list_patients(text)
is 'Returns patient records to active Doctor and Nurse accounts only.';
comment on function public.staff_get_patient_record(text)
is 'Returns patient clinical details to active Doctor and Nurse accounts only.';
comment on function public.staff_update_patient_record(text, text, date, text, text, jsonb, jsonb)
is 'Allows active Doctors and Nurses to update approved patient fields; only Doctors may update prescriptions.';
comment on function public.admin_staff_update_patient_record(text, text, date, text, text, jsonb, jsonb)
is 'Allows active Admins and active Doctors and Nurses to update approved patient fields; only Admins and Doctors may update prescriptions.';
comment on function public.staff_list_patient_accounts()
is 'Returns patient account status to active Doctor and Nurse accounts only.';

commit;
