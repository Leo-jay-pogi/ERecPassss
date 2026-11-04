-- Staff patient management: expose a narrowly scoped, role-checked update RPC.
create schema if not exists app_private;

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

create or replace function app_private.is_active_patient_admin()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and lower(coalesce(profile.role, '')) = 'admin'
      and profile.active is true
  );
$$;

grant usage on schema app_private to authenticated;
revoke all on function app_private.is_clinical_staff() from public, anon;
revoke all on function app_private.is_active_patient_admin() from public, anon;
grant execute on function app_private.is_clinical_staff() to authenticated;
grant execute on function app_private.is_active_patient_admin() to authenticated;

drop policy if exists patients_select_owner_or_staff on public.patients;
create policy patients_select_owner_or_staff
  on public.patients
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or app_private.is_active_patient_admin()
    or app_private.is_clinical_staff()
  );

drop policy if exists patients_update_staff_admin on public.patients;
create policy patients_update_staff_admin
  on public.patients
  for update
  to authenticated
  using (app_private.is_active_patient_admin())
  with check (app_private.is_active_patient_admin());

drop function if exists public.staff_update_patient_record(uuid, text, date, text, text, jsonb, jsonb);

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
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not app_private.is_clinical_staff() then
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
  if jsonb_typeof(coalesce(p_lab_results, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_prescriptions, '[]'::jsonb)) <> 'array' then
    raise exception 'Laboratory results and prescriptions must be JSON arrays.' using errcode = '22023';
  end if;
  if length(coalesce(p_guardian_num, '')) > 40 then
    raise exception 'Guardian contact number must be 40 characters or fewer.' using errcode = '22023';
  end if;
  if length(coalesce(p_doctor_notes, '')) > 4000 then
    raise exception 'Doctor notes must be 4,000 characters or fewer.' using errcode = '22023';
  end if;

  select coalesce(patient.prescriptions, '[]'::jsonb)
  into v_current_prescriptions
  from public.patients as patient
  where patient.id = p_patient_id
  for update;
  if not found then
    raise exception 'Patient record was not found.' using errcode = 'P0002';
  end if;
  if coalesce(p_prescriptions, '[]'::jsonb) is distinct from v_current_prescriptions
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

revoke all on function public.staff_update_patient_record(text, text, date, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.staff_update_patient_record(text, text, date, text, text, jsonb, jsonb) to authenticated;

comment on function public.staff_update_patient_record(text, text, date, text, text, jsonb, jsonb)
is 'Allows active Doctors and Nurses to update approved patient fields; only Doctors may update prescriptions.';
