# Copilot Instructions

## Project shape
- This is a static hospital portal deployed from the repository root to GitHub Pages; there is no package-managed build step.
- `index.html` contains the UI and much of the browser application logic.
- `supabase-client.js` configures the browser client; `supabase-runtime.js` owns shared Supabase data, auth, and realtime behavior.
- Firebase email confirmation and notification/reminder integrations live in their correspondingly named root JavaScript files.
- Supabase Edge Functions and database migrations live under `supabase/functions/` and `supabase/migrations/`.

## Change conventions
- Keep changes focused and follow the existing plain JavaScript, HTML, and SQL patterns. Avoid introducing a build system or dependencies unless the task requires it.
- Trace the existing workflow before changing auth, persistence, or account behavior; preserve existing public interfaces and legacy account support unless explicitly asked otherwise.
- For database behavior, update or add a migration rather than relying on an undocumented dashboard-only change.
- Do not place Supabase secret/service-role keys, admin passwords, or other secrets in browser code or GitHub. Browser code may use only the public publishable key.
- Treat patient and other clinical-style records as sensitive. Use fake/test data for development and verification.

## Verification
- There is no repository-wide automated build or test command configured. For JavaScript changes, run an available syntax check on the touched file and inspect the relevant browser workflow when practical.
- For SQL, inspect the migration for correctness and verify the affected database behavior in a non-production environment when available.
- Do not claim backend or end-to-end verification unless it was actually run.
