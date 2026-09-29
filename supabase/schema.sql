-- FocusFlow user data. Authentication remains in Supabase Auth.
-- Run this in the Supabase SQL Editor before using application data routes.

create table if not exists public.focusflow_user_data (
    user_id uuid not null references auth.users (id) on delete cascade,
    key text not null check (
        key in (
            'focusflow_goals',
            'focusflow_user_state',
            'focusflow_monthly_goal',
            'focusflow_reflection',
            'focusflow_selected_goal'
        )
        or key like 'focusflow_reminder_%'
    ),
    value jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, key)
);

alter table public.focusflow_user_data enable row level security;

drop policy if exists "Users manage their own FocusFlow data"
    on public.focusflow_user_data;
create policy "Users manage their own FocusFlow data"
    on public.focusflow_user_data
    for all
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

revoke all on public.focusflow_user_data from anon, public;
grant select, insert, update, delete
    on public.focusflow_user_data to authenticated;

create table if not exists public.focusflow_support_requests (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    email text not null,
    subject text not null default '' check (char_length(subject) <= 200),
    message text not null check (
        char_length(message) <= 10000 and char_length(btrim(message)) > 0
    ),
    created_at timestamptz not null default now()
);

alter table public.focusflow_support_requests enable row level security;

drop policy if exists "Users submit their own support requests"
    on public.focusflow_support_requests;
create policy "Users submit their own support requests"
    on public.focusflow_support_requests
    for insert
    to authenticated
    with check ((select auth.uid()) = user_id);

revoke all on public.focusflow_support_requests from anon, public, authenticated;
grant insert on public.focusflow_support_requests to authenticated;
