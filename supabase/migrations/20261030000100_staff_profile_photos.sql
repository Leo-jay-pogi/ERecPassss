alter table public.staff
  add column if not exists photo text;

create or replace function public.update_own_staff_photo(p_photo text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  saved_photo text;
begin
  if auth.uid() is null then
    raise exception 'Sign in with a staff account to update its profile photo.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_photo is null
    or length(p_photo) > 900000
    or p_photo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'The profile photo must be a supported image under the size limit.'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.staff
  set photo = p_photo
  where user_id = auth.uid()
    and active is distinct from false
  returning photo into saved_photo;

  if not found then
    raise exception 'No active staff profile was found for this account.'
      using errcode = 'no_data_found';
  end if;

  return saved_photo;
end;
$function$;

revoke all on function public.update_own_staff_photo(text) from public, anon;
grant execute on function public.update_own_staff_photo(text) to authenticated;
