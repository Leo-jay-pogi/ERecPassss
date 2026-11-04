begin;

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
  if auth.uid() is null or not exists (
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

revoke all on function public.staff_list_patient_accounts() from public, anon;
grant execute on function public.staff_list_patient_accounts() to authenticated;

comment on function public.staff_list_patient_accounts()
is 'Returns patient account linkage, active state, and email verification to active Staff accounts without exposing account mutation actions.';

commit;
