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


## Supabase Auth email verification
Firebase Authentication is no longer used for patient or staff sign-in or email verification. Supabase Auth handles email/password accounts, verification codes, and browser sessions.

1. **Supabase Dashboard -> Authentication -> Providers -> Email**: enable Email/Password and enable **Confirm email**.
2. **Authentication -> Email Templates -> Confirm signup**: replace the confirmation-link template with a one-time-code template. For example: `<h2>Verify your ERecPass account</h2><p>Enter this code in ERecPass to verify your email:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>`. Do not include `{{ .ConfirmationURL }}`. The app verifies the entered signup code with Supabase and does not send a redirect URL for signup/resend. This lets patients and invited staff verify without opening the web app from their email.
3. Configure a custom SMTP provider under **Authentication -> SMTP Settings** for production delivery and appropriate sending limits. Supabase's built-in sender is currently limited to 2 emails per hour, even on Pro. Test the confirmation email before inviting users.
4. Apply `supabase/migrations/20261029000100_pending_staff_verification.sql` before deploying the new functions.
5. Deploy the new Staff provisioning functions: `supabase functions deploy admin-create-staff` and `supabase functions deploy complete-staff-registration`. Staff invitations are kept pending until the user verifies the Supabase email and signs in; then the function creates the public Staff record.
6. Patient registration sends Supabase a confirmation code. Users enter that code on the app's **Verify email with a code** screen, then sign in. Login is blocked until confirmation. Registration details are held in that browser until the first verified login, when the app writes/completes the patient record. The patient must use the browser used to register so those details can be saved. Invited staff can open the app, use **Verify email with a code**, enter the invited email and code, then sign in.
7. Existing Firebase patient accounts are not automatically migrated. They need matching Supabase Auth accounts before they can sign in through the new Supabase-only flow. Existing Staff accounts created through the former endpoint continue only if they already have a Supabase profile and Staff row.

### Temporary Staff verification bypass
To create Staff accounts immediately while keeping Patient verification enabled, deploy the updated `admin-create-staff` function, then set the Edge Function secret `STAFF_EMAIL_VERIFICATION_REQUIRED` to `false`. New Staff accounts will be confirmed and added to `profiles` and `staff` immediately; no verification email is sent. Staff can sign in with the password the Admin sets. When finished, set this secret to `true` (or remove it; the function defaults to requiring verification) to restore email verification for new Staff accounts. This does not change existing accounts or patient verification. Supabase secrets take effect without another function deployment. See [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

The new project `onjdhnpaehiqccfkribx` is not the active app target. The app currently points back to the existing project `bfboehvgrivanmrfqquw`.
