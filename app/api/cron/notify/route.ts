import { NextResponse } from "next/server";

import {
  configureWebPush,
  createSupabaseAdminClient,
  dispatchPushNotifications,
  fetchPushSubscriptions,
} from "@/lib/pushNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DueChore = {
  id: string;
  name: string;
  next_due_at: string;
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret) {
    console.error("CRON_SECRET is not configured.");
    return NextResponse.json(
      { error: "Cron authentication is not configured." },
      { status: 500 },
    );
  }

  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401 },
    );
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("chores")
      .select("id, name, next_due_at")
      .eq("is_paused", false)
      .lte("next_due_at", new Date().toISOString())
      .order("next_due_at", { ascending: true });

    if (error) {
      throw new Error(`Due chores could not be loaded: ${error.message}`);
    }

    const dueChores = (data ?? []) as DueChore[];

    if (dueChores.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No chores are currently due.",
        chores: 0,
        subscriptions: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        expired: 0,
      });
    }

    configureWebPush();
    const subscriptions =
      await fetchPushSubscriptions(supabaseAdmin);

    if (subscriptions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Due chores were found, but no devices are subscribed.",
        chores: dueChores.length,
        subscriptions: 0,
        attempted: 0,
        sent: 0,
        failed: 0,
        expired: 0,
      });
    }

    let attempted = 0;
    let sent = 0;
    let failed = 0;
    let expired = 0;

    for (const chore of dueChores) {
      const delivery = await dispatchPushNotifications(
        subscriptions,
        {
          title: `Chore due: ${chore.name}`,
          body: `${chore.name} is ready to be completed.`,
          choreId: chore.id,
          tag: `chore-due-${chore.id}`,
          url: "/",
        },
      );

      attempted += delivery.attempted;
      sent += delivery.sent;
      failed += delivery.failed;
      expired += delivery.expired;
    }

    const allDeliveriesFailed = attempted > 0 && sent === 0;

    return NextResponse.json(
      {
        success: !allDeliveriesFailed,
        message: allDeliveriesFailed
          ? "No subscribed device accepted a due-chore notification."
          : "Due-chore notification run finished.",
        chores: dueChores.length,
        subscriptions: subscriptions.length,
        attempted,
        sent,
        failed,
        expired,
      },
      { status: allDeliveriesFailed ? 502 : 200 },
    );
  } catch (error) {
    console.error("Automated push notification route failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The automated notification run failed.",
      },
      { status: 500 },
    );
  }
}
