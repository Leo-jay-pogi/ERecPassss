# ERecPass Supabase Setup

## Repository wiring
- `index.html` is the existing app entry point and UI.
- `supabase-runtime.js` provides the cloud-backed storage adapter, Auth handling, and Realtime refresh.
- `supabase-client.js` contains only the public browser client configuration.
- Active Supabase project: `https://bfboehvgrivanmrfqquw.supabase.co`
- Tables: `profiles`, `patients`, `staff`, `appointments`, `announcements`, `help_center_messages`, `activity_logs`, `app_settings`
- RLS is enabled.

## Main Admin
The configured main Admin email is `admin2@gmail.com`. The database enforces at most one Admin profile.

Do not hard-code or store the Admin password in GitHub. Use Supabase Auth and Forgot Password for password recovery.

## Admin account management
The protected Edge Function `admin-manage-account` supports:
- create Staff Auth account + Staff database row
- change Patient/Staff password
- edit Patient/Staff name and email
- activate/deactivate Patient/Staff
- permanently delete the linked Patient/Staff Auth account and database records

The Edge Function validates the caller's current Supabase session and requires an active Admin profile before privileged actions.

## Password reset
The browser calls Supabase Auth `resetPasswordForEmail` and uses the current GitHub Pages path as the redirect. In Supabase Authentication URL Configuration, add the exact deployed GitHub Pages URL/path as an allowed redirect URL.

## Recent backend fixes
- Removed duplicate `legacy_id` indexes on appointments and announcements.
- Added indexes for foreign keys on activity logs, announcements, app settings, and appointments.
- Optimized the Staff availability RLS policy.
- Aligned the Admin bootstrap email to `admin2@gmail.com`.
- Fixed the new-user patient-row trigger so it checks the actual `profiles.role` rather than trusting editable signup metadata.

## Security
- Never expose the Supabase secret/service-role key in HTML, JavaScript, GitHub, or screenshots.
- Use the publishable key for browser clients.
- Enable Supabase leaked-password protection.
- Use fake/test patient data until all account, appointment, Help Center, uploads, QR scanning, and multi-device workflows have been tested end-to-end.


## Firebase Email Confirmation Integration
To prevent hitting Supabase free-tier email rate limits (3 emails/hour), patient account email confirmation is handled by Firebase Auth (`firebase-auth-client.js`):
1. **Firebase Console**: Ensure **Authentication -> Sign-in method -> Email/Password** is enabled on project `erecpass-portal` (the project configured in `firebase-auth-client.js`).
2. Verification emails use Firebase's default action page without an app continue URL, so clicking the link shows Firebase's email-verified confirmation and does not automatically return to ERecPass.
3. The app creates/signs into the matching Supabase Auth account on the patient's first verified login, then records the patient in `public.patients`. The registration fields are combined as `First Middle Last` and saved in the `full_name` column; if the patient has no middle name, it saves `First Last`.
4. **Supabase Dashboard**: In **Authentication -> Providers -> Email**, uncheck **"Confirm email"** because Firebase already verified the address. This allows the first Supabase login to create a usable session without sending a second email.
5. Existing Firebase accounts must verify their email before the first account sync. Existing legacy accounts not present in Firebase can log into Supabase only when their Supabase profile and patient row already exist.

The new project `onjdhnpaehiqccfkribx` is not the active app target. The app currently points back to the existing project `bfboehvgrivanmrfqquw`.
