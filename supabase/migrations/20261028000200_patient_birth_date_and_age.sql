-- Store the date of birth and the age calculated at the patient's first login.
alter table public.patients
  add column if not exists birth_date date,
  add column if not exists age integer;
