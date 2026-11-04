begin;

create or replace function public.update_own_staff_profile(
  p_name text,
  p_title text,
  p_task text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_staff public.staff%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_title text := btrim(coalesce(p_title, ''));
  v_task text := btrim(coalesce(p_task, ''));
begin
  if auth.uid() is null then
    raise exception 'Sign in with an active Staff account to update this profile.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_name = '' or length(v_name) > 120 then
    raise exception 'Name is required and must be 120 characters or fewer.'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_title) > 160 then
    raise exception 'Role or department must be 160 characters or fewer.'
      using errcode = 'invalid_parameter_value';
  end if;
  if length(v_task) > 500 then
    raise exception 'Assigned task must be 500 characters or fewer.'
      using errcode = 'invalid_parameter_value';
  end if;

  select staff_account.*
  into v_staff
  from public.staff as staff_account
  join public.profiles as profile on profile.id = staff_account.user_id
  where staff_account.user_id = auth.uid()
    and staff_account.active is true
    and profile.role = 'staff'
    and profile.active is true
  for update of staff_account;

  if not found then
    raise exception 'No active Staff profile was found for this account.'
      using errcode = 'no_data_found';
  end if;

  update public.staff
  set name = v_name,
      role_title = v_title,
      professional_title = v_title,
      task = v_task
  where id = v_staff.id;

  update public.profiles
  set full_name = v_name
  where id = auth.uid()
    and role = 'staff'
    and active is true;

  return jsonb_build_object(
    'name', v_name,
    'role_title', v_title,
    'professional_title', v_title,
    'task', v_task
  );
end;
$function$;

revoke all on function public.update_own_staff_profile(text, text, text) from public, anon;
grant execute on function public.update_own_staff_profile(text, text, text) to authenticated;

create or replace function public.remove_own_staff_photo()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in with an active Staff account to remove this profile photo.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.staff as staff_account
  set photo = null
  from public.profiles as profile
  where staff_account.user_id = auth.uid()
    and staff_account.active is true
    and profile.id = auth.uid()
    and profile.role = 'staff'
    and profile.active is true;

  if not found then
    raise exception 'No active Staff profile was found for this account.'
      using errcode = 'no_data_found';
  end if;

  return true;
end;
$function$;

revoke all on function public.remove_own_staff_photo() from public, anon;
grant execute on function public.remove_own_staff_photo() to authenticated;

commit;
