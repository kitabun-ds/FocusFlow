# Supabase setup

1. In the Supabase SQL Editor for the configured project, run [`schema.sql`](schema.sql). It creates the user data table, enables RLS, and limits row access to the authenticated owner.
2. Keep the table in the exposed `public` schema (or expose it through the Supabase Data API settings). Requests use the signed-in user's access token and the publishable key; the app does not use a service-role key.
3. In Authentication settings, enable email/password sign-in and set the Site URL and allowed redirect URLs for the local app and deployed app. Include the app's `/reset-password` route for recovery redirects.
4. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and a stable random `FOCUSFLOW_SECRET_KEY` in the server environment. Set `FOCUSFLOW_COOKIE_SECURE=1` when running behind HTTPS. See [`.env.example`](../.env.example).

Existing SQLite accounts cannot be carried over with their current password hashes. Users need to create/reset their credentials through Supabase Auth. Existing browser-only goal data has no trustworthy account owner, so it is intentionally not imported automatically; new edits are stored in Supabase per signed-in user.
