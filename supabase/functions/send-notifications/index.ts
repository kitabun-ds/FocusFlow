import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { quoteLibrary } from "./quotes.ts";
import { asArray, parseStoredValue, taskForUser } from "./rules.js";

const TITLES: Record<string, string> = {
  morning: "A fresh start",
  night: "Plan a gentle restart",
  incomplete_goals: "A goal is ready when you are",
  streak: "Keep your practice going",
  completion: "Goal completed",
  comeback: "Welcome back to FocusFlow",
};

const TYPE_COPY: Record<string, string> = {
  morning: "Add today's goals when you're ready.",
  night: "Some goals expire soon. Set an intention for the next day.",
  incomplete_goals: "Choose one unfinished goal and move it forward.",
  streak: "A small action today can keep your practice alive.",
  completion: "You completed all of today's goals. Take a moment to enjoy it.",
  comeback: "A small next step is enough to begin again.",
};

const REQUIRED_DATA_KEYS = ["focusflow_goals", "focusflow_user_state"];

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function supportedPushEndpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === "https:" && (!parsed.port || parsed.port === "443") && (
      host === "fcm.googleapis.com"
      || host === "web.push.apple.com"
      || host === "updates.push.services.mozilla.com"
      || host.endsWith(".notify.windows.com")
    );
  } catch (_) {
    return false;
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getServiceRoleKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const secrets = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return secrets.default || Object.values(secrets)[0] || "";
  } catch (_) {
    return "";
  }
}

Deno.serve(async request => {
  if (request.method !== "POST") return response({ error: "POST required" }, 405);

  const cronSecret = Deno.env.get("NOTIFICATION_CRON_SECRET") || "";
  const providedSecret = request.headers.get("x-notification-cron-secret") || "";
  if (!cronSecret || !timingSafeEqual(providedSecret, cronSecret)) {
    return response({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = getServiceRoleKey();
  const vapidPublicKey = Deno.env.get("NOTIFICATION_VAPID_PUBLIC_KEY") || "";
  const vapidPrivateKey = Deno.env.get("NOTIFICATION_VAPID_PRIVATE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return response({ error: "Notification server secrets are not configured" }, 503);
  }

  webpush.setVapidDetails(
    Deno.env.get("NOTIFICATION_VAPID_SUBJECT") || "mailto:support@focusflow.app",
    vapidPublicKey,
    vapidPrivateKey,
  );
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stats = { usersChecked: 0, claimed: 0, sent: 0, failed: 0, expired: 0 };

  const { data: preferences, error: preferencesError } = await supabase
    .from("focusflow_notification_preferences")
    .select("user_id,enabled,timezone,categories")
    .eq("enabled", true);
  if (preferencesError) return response({ error: "Could not load notification preferences" }, 500);

  for (const preference of preferences || []) {
    stats.usersChecked += 1;
    const userId = preference.user_id as string;
    const userNow = new Date();
    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("focusflow_push_subscriptions")
      .select("endpoint_hash,endpoint,p256dh,auth")
      .eq("user_id", userId);
    if (subscriptionsError || !subscriptions?.length) continue;

    const { data: userRows, error: userDataError } = await supabase
      .from("focusflow_user_data")
      .select("key,value")
      .eq("user_id", userId)
      .in("key", REQUIRED_DATA_KEYS);
    if (userDataError) continue;
    const values = Object.fromEntries((userRows || []).map(row => [row.key, row.value]));
    const goals = asArray(parseStoredValue(values.focusflow_goals, []));
    const state = parseStoredValue(values.focusflow_user_state, {});
    const tasks = taskForUser(userId, preference, goals, state || {}, userNow);
    for (const task of tasks) {
      const availableQuotes = quoteLibrary.filter(item => item.category === task.quoteCategory);
      if (!availableQuotes.length) continue;
      const { data: claimRows, error: claimError } = await supabase.rpc("focusflow_claim_notification", {
        p_user_id: userId,
        p_notification_type: task.type,
        p_event_key: task.eventKey,
        p_quote_category: task.quoteCategory,
        p_quote_ids: availableQuotes.map(item => item.id),
      });
      if (claimError) continue;
      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      if (!claim?.claimed) continue;
      stats.claimed += 1;

      const selectedQuote = availableQuotes.find(item => item.id === claim.quote_id) || availableQuotes[0];
      const body = `${selectedQuote.text} ${TYPE_COPY[task.type]}`;
      let delivered = 0;
      const sendResults = await Promise.all(subscriptions.map(async subscription => {
        if (!supportedPushEndpoint(subscription.endpoint)) {
          await supabase.from("focusflow_push_subscriptions")
            .delete().eq("endpoint_hash", subscription.endpoint_hash);
          stats.expired += 1;
          return "unsupported push service endpoint";
        }
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify({
            title: TITLES[task.type],
            body,
            tag: `${userId}:${task.type}:${task.eventKey}`,
            eventKey: `${task.type}:${task.eventKey}`,
            path: task.path,
            icon: "/static/images/sunocean.jpeg",
          }), { TTL: 86400, urgency: "normal" });
          delivered += 1;
          return null;
        } catch (error) {
          const status = Number((error as any)?.statusCode || (error as any)?.status || 0);
          if (status === 404 || status === 410) {
            await supabase.from("focusflow_push_subscriptions")
              .delete().eq("endpoint_hash", subscription.endpoint_hash);
            stats.expired += 1;
          }
          return `${status || "push"}: ${(error as Error)?.message || "delivery failed"}`;
        }
      }));

      if (delivered > 0) {
        stats.sent += 1;
        await supabase.from("focusflow_notification_deliveries").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
        }).eq("id", claim.delivery_id);
      } else {
        stats.failed += 1;
        const errors = sendResults.filter(Boolean).join("; ").slice(0, 1000);
        await supabase.from("focusflow_notification_deliveries").update({
          status: "failed",
          last_error: errors || "No push endpoint accepted the notification.",
        }).eq("id", claim.delivery_id);
      }
      break;
    }
  }

  console.log("FocusFlow notification run", stats);
  return response(stats);
});
