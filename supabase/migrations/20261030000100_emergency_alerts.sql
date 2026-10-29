create table if not exists public.emergency_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  message text not null,
  latitude double precision,
  longitude double precision,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists emergency_alerts_created_at_idx
  on public.emergency_alerts (created_at desc);

create or replace function public.prepare_emergency_alert_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if new.status = 'acknowledged' then
    new.latitude := null;
    new.longitude := null;
  end if;
  return new;
end;
$$;

revoke all on function public.prepare_emergency_alert_update() from public, anon, authenticated;
drop trigger if exists clear_emergency_alert_location_on_ack on public.emergency_alerts;
drop trigger if exists prepare_emergency_alert_update on public.emergency_alerts;
create trigger prepare_emergency_alert_update
  before update on public.emergency_alerts
  for each row
  execute function public.prepare_emergency_alert_update();

alter table public.emergency_alerts enable row level security;
revoke all on table public.emergency_alerts from public, anon, authenticated;
grant select, insert, update on table public.emergency_alerts to authenticated;

drop policy if exists erecpass_active_admin_read_emergency_alerts on public.emergency_alerts;
create policy erecpass_active_admin_read_emergency_alerts
  on public.emergency_alerts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and p.active is true
    )
  );

drop policy if exists erecpass_report_own_emergency_alert on public.emergency_alerts;
create policy erecpass_report_own_emergency_alert
  on public.emergency_alerts
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'new'
  );

drop policy if exists erecpass_active_admin_update_emergency_alerts on public.emergency_alerts;
create policy erecpass_active_admin_update_emergency_alerts
  on public.emergency_alerts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and p.active is true
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
        and p.active is true
    )
  );
