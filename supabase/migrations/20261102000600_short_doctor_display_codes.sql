begin;

create sequence if not exists public.doctor_display_code_seq;

alter table public.doctor_profiles
  add column if not exists short_code text;

update public.doctor_profiles
set short_code = 'DOC-' || to_char(nextval('public.doctor_display_code_seq'), 'FM0000')
where nullif(btrim(short_code), '') is null;

alter table public.doctor_profiles
  alter column short_code set default ('DOC-' || to_char(nextval('public.doctor_display_code_seq'), 'FM0000')),
  alter column short_code set not null;

create unique index if not exists doctor_profiles_short_code_uidx
  on public.doctor_profiles(short_code);

grant usage, select on sequence public.doctor_display_code_seq to authenticated;

commit;
