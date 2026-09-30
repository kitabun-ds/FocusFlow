-- Durable Web Push subscriptions, user preferences, idempotency, and quote rotation.
-- All notification data is server-managed; clients only reach it through authenticated Flask routes.

create table if not exists public.focusflow_notification_preferences (
    user_id uuid primary key references auth.users (id) on delete cascade,
    enabled boolean not null default false,
    timezone text not null default 'UTC' check (char_length(timezone) between 1 and 100),
    categories jsonb not null default '{"morning":true,"night":true,"incomplete_goals":true,"streak":true,"completion":true,"comeback":true}'::jsonb
        check (jsonb_typeof(categories) = 'object'),
    updated_at timestamptz not null default now()
);

create index if not exists focusflow_notification_preferences_enabled_idx
    on public.focusflow_notification_preferences (user_id)
    where enabled = true;
alter table public.focusflow_notification_preferences enable row level security;
revoke all on public.focusflow_notification_preferences from anon, public, authenticated;
grant select, insert, update, delete on public.focusflow_notification_preferences to service_role;

create table if not exists public.focusflow_push_subscriptions (
    endpoint_hash text primary key check (endpoint_hash ~ '^[a-f0-9]{64}$'),
    user_id uuid not null references auth.users (id) on delete cascade,
    endpoint text not null check (char_length(endpoint) <= 2048),
    p256dh text not null,
    auth text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create index if not exists focusflow_push_subscriptions_user_idx
    on public.focusflow_push_subscriptions (user_id);
alter table public.focusflow_push_subscriptions enable row level security;
revoke all on public.focusflow_push_subscriptions from anon, public, authenticated;
grant select, insert, update, delete on public.focusflow_push_subscriptions to service_role;

create or replace function public.focusflow_register_push_subscription(
    p_endpoint_hash text,
    p_user_id uuid,
    p_endpoint text,
    p_p256dh text,
    p_auth_key text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_registered boolean;
begin
    insert into public.focusflow_push_subscriptions (
        endpoint_hash, user_id, endpoint, p256dh, auth
    ) values (
        p_endpoint_hash, p_user_id, p_endpoint, p_p256dh, p_auth_key
    )
    on conflict (endpoint_hash) do update
       set endpoint = excluded.endpoint,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           updated_at = now(),
           last_seen_at = now()
     where focusflow_push_subscriptions.user_id = excluded.user_id
    returning true into v_registered;

    return coalesce(v_registered, false);
end;
$$;

revoke all on function public.focusflow_register_push_subscription(text, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.focusflow_register_push_subscription(text, uuid, text, text, text) to service_role;

create table if not exists public.focusflow_notification_deliveries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    notification_type text not null check (notification_type in (
        'morning', 'night', 'incomplete_goals', 'streak', 'completion', 'comeback'
    )),
    event_key text not null check (char_length(event_key) between 1 and 250),
    quote_category text not null check (quote_category in (
        'morning', 'night', 'goal_start', 'incomplete_goals', 'streak',
        'completion', 'progress', 'consistency', 'comeback', 'focus'
    )),
    quote_id text,
    status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
    attempts smallint not null default 1 check (attempts between 1 and 3),
    created_at timestamptz not null default now(),
    sent_at timestamptz,
    last_error text,
    unique (user_id, notification_type, event_key)
);

create index if not exists focusflow_notification_deliveries_cooldown_idx
    on public.focusflow_notification_deliveries (user_id, sent_at desc)
    where status = 'sent';
alter table public.focusflow_notification_deliveries enable row level security;
revoke all on public.focusflow_notification_deliveries from anon, public, authenticated;
grant select, insert, update, delete on public.focusflow_notification_deliveries to service_role;

create table if not exists public.focusflow_notification_quote_cycles (
    user_id uuid not null references auth.users (id) on delete cascade,
    category text not null check (category in (
        'morning', 'night', 'goal_start', 'incomplete_goals', 'streak',
        'completion', 'progress', 'consistency', 'comeback', 'focus'
    )),
    cycle integer not null default 0,
    recent_quote_ids text[] not null default '{}',
    updated_at timestamptz not null default now(),
    primary key (user_id, category)
);

create table if not exists public.focusflow_notification_quote_usage (
    user_id uuid not null references auth.users (id) on delete cascade,
    category text not null,
    cycle integer not null,
    quote_id text not null,
    used_at timestamptz not null default now(),
    primary key (user_id, category, cycle, quote_id)
);

alter table public.focusflow_notification_quote_cycles enable row level security;
alter table public.focusflow_notification_quote_usage enable row level security;
revoke all on public.focusflow_notification_quote_cycles from anon, public, authenticated;
revoke all on public.focusflow_notification_quote_usage from anon, public, authenticated;
grant select, insert, update, delete on public.focusflow_notification_quote_cycles to service_role;
grant select, insert, update, delete on public.focusflow_notification_quote_usage to service_role;

-- Edge Function reads the existing per-user goals and Track history as its source of truth.
do $$
begin
    if to_regclass('public.focusflow_user_data') is not null then
        execute 'grant select on public.focusflow_user_data to service_role';
    end if;
end;
$$;

create or replace function public.focusflow_claim_notification(
    p_user_id uuid,
    p_notification_type text,
    p_event_key text,
    p_quote_category text,
    p_quote_ids text[]
)
returns table (claimed boolean, delivery_id uuid, quote_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_delivery_id uuid;
    v_cycle integer;
    v_recent text[];
    v_quote_id text;
begin
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

    if exists (
        select 1 from public.focusflow_notification_deliveries sent
         where sent.user_id = p_user_id
           and ((sent.status = 'sent' and sent.sent_at > now() - interval '8 hours')
                or (sent.status = 'claimed' and sent.created_at > now() - interval '10 minutes'))
    ) then
        return query select false, null::uuid, null::text;
        return;
    end if;

    insert into public.focusflow_notification_deliveries (
        user_id, notification_type, event_key, quote_category
    ) values (
        p_user_id, p_notification_type, p_event_key, p_quote_category
    )
    on conflict (user_id, notification_type, event_key) do nothing
    returning id into v_delivery_id;

    if v_delivery_id is null then
        select id, focusflow_notification_deliveries.quote_id
          into v_delivery_id, v_quote_id
          from public.focusflow_notification_deliveries
         where user_id = p_user_id
           and notification_type = p_notification_type
           and event_key = p_event_key
           and status = 'failed'
           and attempts < 3
           and created_at + (attempts * interval '5 minutes') <= now()
         for update;
        if v_delivery_id is not null then
            update public.focusflow_notification_deliveries
               set status = 'claimed', attempts = attempts + 1, last_error = null
             where id = v_delivery_id;
            return query select true, v_delivery_id, v_quote_id;
            return;
        end if;
        return query select false, null::uuid, null::text;
        return;
    end if;

    insert into public.focusflow_notification_quote_cycles (user_id, category)
    values (p_user_id, p_quote_category)
    on conflict (user_id, category) do nothing;

    select cycle, recent_quote_ids
      into v_cycle, v_recent
      from public.focusflow_notification_quote_cycles
     where user_id = p_user_id and category = p_quote_category
     for update;

    select candidate.quote_id into v_quote_id
      from (select distinct unnest(p_quote_ids) as quote_id) candidate
     where not (candidate.quote_id = any(v_recent))
       and not exists (
           select 1 from public.focusflow_notification_quote_usage used
            where used.user_id = p_user_id
              and used.category = p_quote_category
              and used.cycle = v_cycle
              and used.quote_id = candidate.quote_id
       )
     order by md5(p_user_id::text || p_quote_category || v_cycle::text || candidate.quote_id)
     limit 1;

    if v_quote_id is null then
        v_cycle := v_cycle + 1;
        select candidate.quote_id into v_quote_id
          from (select distinct unnest(p_quote_ids) as quote_id) candidate
         where not (candidate.quote_id = any(v_recent))
         order by md5(p_user_id::text || p_quote_category || v_cycle::text || candidate.quote_id)
         limit 1;
    end if;

    if v_quote_id is null then
        raise exception 'No unused notification quote is available';
    end if;

    insert into public.focusflow_notification_quote_usage (
        user_id, category, cycle, quote_id
    ) values (p_user_id, p_quote_category, v_cycle, v_quote_id);

    v_recent := array_append(v_recent, v_quote_id);
    if cardinality(v_recent) > 10 then
        v_recent := v_recent[(cardinality(v_recent) - 9):cardinality(v_recent)];
    end if;
    update public.focusflow_notification_quote_cycles
       set cycle = v_cycle, recent_quote_ids = v_recent, updated_at = now()
     where user_id = p_user_id and category = p_quote_category;

    update public.focusflow_notification_deliveries
       set quote_id = v_quote_id
     where id = v_delivery_id;

    return query select true, v_delivery_id, v_quote_id;
end;
$$;

revoke all on function public.focusflow_claim_notification(uuid, text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.focusflow_claim_notification(uuid, text, text, text, text[]) to service_role;
