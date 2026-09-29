# Supabase setup

1. In the Supabase SQL Editor for the configured project, run [`schema.sql`](schema.sql). It creates the user data and support request tables and configures their row-level security policies.
2. Review submitted Support requests in the Supabase Table Editor under `focusflow_support_requests`. Signed-in users can submit only their own request; they cannot read other requests.
3. Keep the tables in the exposed `public` schema (or expose them through the Supabase Data API settings). Requests use the signed-in user's access token and the publishable key; the app does not use a service-role key for submissions.
4. In Authentication settings, enable email/password sign-in and set the Site URL and allowed redirect URLs for the local app and deployed app. Include the app's `/reset-password` route for recovery redirects.
5. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and a stable random `FOCUSFLOW_SECRET_KEY` in the server environment. Set `FOCUSFLOW_COOKIE_SECURE=1` when running behind HTTPS. See [`.env.example`](../.env.example).

Existing SQLite accounts cannot be carried over with their current password hashes. Users need to create/reset their credentials through Supabase Auth. Existing browser-only goal data has no trustworthy account owner, so it is intentionally not imported automatically; new edits are stored in Supabase per signed-in user.
