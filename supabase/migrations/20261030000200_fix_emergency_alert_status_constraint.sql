-- Align existing emergency alert tables with the status values used by the app.
-- NOT VALID avoids rejecting older rows while still enforcing the values for
-- new inserts and updates.
alter table public.emergency_alerts
  drop constraint if exists emergency_alerts_status_check;

alter table public.emergency_alerts
  add constraint emergency_alerts_status_check
  check (status in ('new', 'acknowledged')) not valid;
