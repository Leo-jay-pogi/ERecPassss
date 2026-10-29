# ERecPass — Hospital Portal

ERecPass is a hospital portal with a Supabase-backed data layer. The existing UI remains in `index.html`; `supabase-runtime.js` handles Auth, cloud data synchronization, and Realtime refreshes.

## Backend
- Supabase project: `ERECPASS`
- Active Supabase project URL: `https://bfboehvgrivanmrfqquw.supabase.co`
- Browser client uses the Supabase **publishable** key only.
- Tables: `profiles`, `patients`, `staff`, `appointments`, `announcements`, `help_center_messages`, `activity_logs`, `app_settings`, `emergency_alerts`
- RLS is enabled on all exposed public tables.
- Admin account operations use the protected `admin-manage-account` Edge Function.
- GitHub Pages workflow: `.github/workflows/pages.yml`

## Account limits (Supabase-enforced)
- Maximum **20 Patient** profiles.
- Maximum **15 Staff** profiles.
- Maximum **4 Admin** profiles.
- These are maximum account counts, not accounts automatically created.
- A database trigger enforces the caps on profile creation and role changes; existing accounts and unrelated app functions are preserved.
- Current Supabase profile counts at last verification: **4 Patient**, **2 Staff**, **1 Admin**.
- Migration source: `supabase/migrations/20261016_account_limits.sql`.

## Authentication
- Patient and Staff email/password authentication and email verification use Supabase Auth.
- Enable **Confirm email** in Supabase Auth and allow the deployed GitHub Pages URL as a redirect URL.
- Staff invitations use the `admin-create-staff` and `complete-staff-registration` Supabase Edge Functions. Apply the pending-staff migration and deploy both functions before enabling the updated app.
- Patient registration details are saved to the patient record after the first verified login; that login must happen in the browser used to register.
- Firebase Authentication is no longer part of the login or email verification flow. Firebase Cloud Messaging remains available for push notifications.

## Password reset
The app uses Supabase Auth password recovery. The reset link returns to the current GitHub Pages path and the app handles the `PASSWORD_RECOVERY` event before allowing the new password to be saved.

If a reset link shows a 404, make sure the GitHub Pages URL is registered in Supabase Authentication URL Configuration as an allowed redirect URL.

## Emergency alerts
- For a new database, use `supabase/migrations/20261030000100_emergency_alerts.sql`. Existing databases with the verified alert columns do not need a schema migration for the frontend column-name fix.
- For an existing database that rejects `new` alert rows with `emergency_alerts_status_check`, apply `supabase/migrations/20261030000200_fix_emergency_alert_status_constraint.sql`.
- The alert workflow uses the existing `user_id`, `message`, `latitude`, `longitude`, `status`, `created_at`, and `updated_at` columns. It does not require a patient foreign key or a `patient_id` column.
- Enable Supabase Anonymous Sign-Ins so a pre-login alert can be recorded with a temporary authenticated identity. If anonymous sign-in is unavailable, the app reports that the admin alert could not be sent; the phone call options remain available.
- The patient emergency gesture is three taps followed by a three-second animated countdown; two taps on the emergency button within one second cancel during that countdown. When it completes, the app sends the admin alert and opens call options. The app requests location permission when sending. Call links open the device dialer; the user must confirm the call. The 911 option remains available.
- Android APK builds bundle Capacitor Geolocation and declare coarse and precise location permissions so the emergency alert can request location access in-app.
- GPS coordinates are optional and visible only to active admins. The Admin Emergency Alert Dashboard refreshes alerts every 15 seconds while the Admin console is open. Admins can optionally enable browser desktop notifications; acknowledging an alert clears its saved coordinates.
- Verify the Barangay hotline in Admin Settings before relying on it. The built-in example number is disabled; do not treat it as a real emergency contact.

## Database/security maintenance
- Foreign-key indexes were added for common account/audit relationships.
- Duplicate legacy-id indexes were removed.
- Staff availability RLS was optimized to evaluate `auth.uid()` once per statement.
- The Admin email bootstrap trigger is aligned to `admin2@gmail.com`.
- New Auth users are assigned a patient row only when the resulting profile role is actually `patient`, preventing Admin/Staff accounts from accidentally receiving patient records.

## Important
Do not put a Supabase secret/service-role key in browser code or GitHub. The browser file must contain only the publishable key.

Supabase's leaked-password protection should also be enabled in Authentication security settings. This project can contain clinical-style records, so use test/fake patient data until full end-to-end testing and privacy review are complete.


<!-- ERecPass deployment refresh: 2026-10-07T16:45:35.740Z -->
