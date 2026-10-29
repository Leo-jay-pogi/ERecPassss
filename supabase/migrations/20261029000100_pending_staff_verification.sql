-- Keep invitation details inaccessible to browser users until email confirmation.
create table if not exists public.pending_staff_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role_title text not null default 'Staff',
  task text not null default 'General Duty',
  created_at timestamptz not null default now()
);

alter table public.pending_staff_accounts enable row level security;
revoke all on table public.pending_staff_accounts from public, anon, authenticated;
grant all on table public.pending_staff_accounts to service_role;
