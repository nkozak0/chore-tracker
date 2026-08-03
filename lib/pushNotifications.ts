import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

export type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  auth_key: string;
  p256dh_key: string;
};

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  choreId?: string;
  tag?: string;
};

export function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export function configureWebPush() {
  const publicKey =
    process.env.NEXT_PUBLIC_VAPID_KEY ??
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject =
    process.env.VAPID_SUBJECT ?? "mailto:test@example.com";

  if (!publicKey || !privateKey) {
    throw new Error(
      "NEXT_PUBLIC_VAPID_KEY and VAPID_PRIVATE_KEY must be configured.",
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export async function fetchPushSubscriptions(
  supabaseAdmin: SupabaseClient,
) {
  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, auth_key, p256dh_key");

  if (error) {
    throw new Error(
      `Push subscriptions could not be loaded: ${error.message}`,
    );
  }

  return (data ?? []) as PushSubscriptionRow[];
}

function getStatusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }

  return null;
}

export async function dispatchPushNotifications(
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload,
) {
  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              auth: subscription.auth_key,
              p256dh: subscription.p256dh_key,
            },
          },
          JSON.stringify(payload),
          {
            TTL: 60 * 60,
            timeout: 10_000,
          },
        );

        return { sent: true, expired: false };
      } catch (error) {
        const statusCode = getStatusCode(error);
        const expired = statusCode === 404 || statusCode === 410;

        console.error("Push notification delivery failed:", {
          subscriptionId: subscription.id,
          statusCode,
          expired,
          message:
            error instanceof Error
              ? error.message
              : "Unknown web-push failure",
        });

        return { sent: false, expired };
      }
    }),
  );

  return {
    attempted: subscriptions.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length,
    expired: results.filter((result) => result.expired).length,
  };
}
