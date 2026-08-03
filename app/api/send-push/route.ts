import { NextResponse } from "next/server";

import {
  configureWebPush,
  createSupabaseAdminClient,
  dispatchPushNotifications,
  fetchPushSubscriptions,
} from "@/lib/pushNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ManualPushBody = {
  choreId?: unknown;
  choreName?: unknown;
  completedBy?: unknown;
  nextDueAt?: unknown;
};

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

export async function POST(request: Request) {
  try {
    const accessToken = getBearerToken(request);

    if (!accessToken) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const {
      data: { user },
      error: authenticationError,
    } = await supabaseAdmin.auth.getUser(accessToken);

    if (authenticationError || !user) {
      return NextResponse.json(
        { error: "The notification session is invalid or expired." },
        { status: 401 },
      );
    }

    let body: ManualPushBody;

    try {
      body = (await request.json()) as ManualPushBody;
    } catch {
      return NextResponse.json(
        { error: "The request body must be valid JSON." },
        { status: 400 },
      );
    }

    const choreId =
      typeof body.choreId === "string" ? body.choreId.trim() : "";
    const completedBy =
      typeof body.completedBy === "string"
        ? body.completedBy.trim()
        : "";

    if (!choreId || !completedBy) {
      return NextResponse.json(
        { error: "choreId and completedBy are required." },
        { status: 400 },
      );
    }

    const [choreResult, profileResult] = await Promise.all([
      supabaseAdmin
        .from("chores")
        .select("id, name, next_due_at")
        .eq("id", choreId)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("id", completedBy)
        .maybeSingle(),
    ]);

    if (choreResult.error || !choreResult.data) {
      return NextResponse.json(
        {
          error:
            choreResult.error?.message ?? "The completed chore was not found.",
        },
        { status: 404 },
      );
    }

    if (profileResult.error) {
      console.error(
        "Completed-by profile lookup failed:",
        profileResult.error,
      );
    }

    configureWebPush();
    const subscriptions =
      await fetchPushSubscriptions(supabaseAdmin);
    const completedByName =
      profileResult.data?.display_name ?? "Someone";
    const delivery = await dispatchPushNotifications(
      subscriptions,
      {
        title: `${completedByName} completed a chore`,
        body: `${choreResult.data.name} is complete.`,
        choreId: choreResult.data.id,
        tag: `chore-completed-${choreResult.data.id}`,
        url: "/",
      },
    );

    const allDeliveriesFailed =
      delivery.attempted > 0 && delivery.sent === 0;

    return NextResponse.json(
      {
        success: !allDeliveriesFailed,
        error: allDeliveriesFailed
          ? "No subscribed device accepted the notification."
          : undefined,
        message:
          subscriptions.length === 0
            ? "The chore was completed, but no devices are subscribed."
            : allDeliveriesFailed
              ? "No subscribed device accepted the notification."
              : "The completion notification handoff finished.",
        delivery,
      },
      { status: allDeliveriesFailed ? 502 : 200 },
    );
  } catch (error) {
    console.error("Manual push notification route failed:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The notification handoff failed.",
      },
      { status: 500 },
    );
  }
}
