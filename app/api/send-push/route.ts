import { NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// 1. Initialize web-push with your environment variables
const subject = process.env.VAPID_SUBJECT || "mailto:test@example.com";
// Note: Using NEXT_PUBLIC_VAPID_KEY to match your Vercel dashboard naming
const publicKey = process.env.NEXT_PUBLIC_VAPID_KEY || ""; 
const privateKey = process.env.VAPID_PRIVATE_KEY || "";

webpush.setVapidDetails(subject, publicKey, privateKey);

// Vercel Cron Jobs default to sending GET requests
export async function GET(request: Request) {
  // 2. Security Check: Ensure this request is actually coming from Vercel
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 3. Initialize Supabase Admin Client (Bypasses RLS)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json({ error: "Missing Supabase credentials" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 4. Fetch the subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("*");

    if (subError) throw subError;
    if (!subscriptions || subscriptions.length === 0) {
      return NextResponse.json({ message: "No active subscriptions found." }, { status: 200 });
    }

    // 5. Build and send the notifications
    const notifications = subscriptions.map((sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          auth: sub.auth_key,
          p256dh: sub.p256dh_key,
        },
      };

      const payload = JSON.stringify({
        title: "Chore Reminder",
        body: "You have chores due today. Open the app to check your list!",
      });

      // Send the push and catch any errors (like if a user unsubscribed)
      return webpush
        .sendNotification(pushSubscription, payload)
        .catch((err: unknown) => {
          console.error("Push failed for endpoint:", sub.endpoint, err);
        });
    });

    // Wait for all notifications to be sent
    await Promise.all(notifications);

    return NextResponse.json({ 
      success: true, 
      delivered: notifications.length 
    }, { status: 200 });

  } catch (error) {
    console.error("Cron Job Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
