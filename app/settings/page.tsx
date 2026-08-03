"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlarmClock,
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RotateCcw,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSelectedProfileId } from "@/lib/session";
import { supabase } from "@/lib/supabaseClient";
import type { Chore } from "@/lib/supabaseClient";

const choreSelect =
  "id, name, interval_minutes, snooze_minutes, next_due_at, is_paused, last_completed_by, claimed_by" as const;
const pushSubscriptionStorageKey = "chore-tracker.push-subscription";

type PushStatus =
  | "checking"
  | "unsupported"
  | "unsubscribed"
  | "subscribed"
  | "denied"
  | "missing-key"
  | "error";

type Notice = {
  id: number;
  message: string;
  tone: "error" | "success";
};

function sortChores(items: Chore[]) {
  return [...items].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
}

function upsertChore(items: Chore[], nextChore: Chore) {
  const exists = items.some((chore) => chore.id === nextChore.id);

  return sortChores(
    exists
      ? items.map((chore) =>
          chore.id === nextChore.id ? nextChore : chore,
        )
      : [...items, nextChore],
  );
}

function formatDuration(minutes: number) {
  if (minutes < 60) {
    return `${minutes} min`;
  }

  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const normalized = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(normalized);

  return Uint8Array.from(rawData, (character) => character.charCodeAt(0));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  step: string,
) {
  let timeoutId: number | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error(`${step} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId);
    }
  }
}

function waitForServiceWorkerActivation(
  registration: ServiceWorkerRegistration,
) {
  if (registration.active) {
    return Promise.resolve(registration);
  }

  const worker =
    registration.installing ?? registration.waiting ?? registration.active;

  if (!worker) {
    return Promise.reject(
      new Error("The service worker registration has no worker to activate."),
    );
  }

  if (worker.state === "activated") {
    return Promise.resolve(registration);
  }

  return new Promise<ServiceWorkerRegistration>((resolve, reject) => {
    const handleStateChange = () => {
      if (worker.state === "activated") {
        worker.removeEventListener("statechange", handleStateChange);
        resolve(registration);
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", handleStateChange);
        reject(
          new Error("The service worker became redundant before activation."),
        );
      }
    };

    worker.addEventListener("statechange", handleStateChange);
  });
}

async function getPushRegistration() {
  try {
    const existingRegistration =
      await navigator.serviceWorker.getRegistration("/");

    if (existingRegistration?.active) {
      console.log("Using existing active service worker registration:", {
        scriptURL: existingRegistration.active.scriptURL,
        scope: existingRegistration.scope,
      });
      return existingRegistration;
    }

    console.log(
      "No active service worker registration found. Registering /next-pwa-sw.js.",
    );

    const registration = await navigator.serviceWorker.register(
      "/next-pwa-sw.js",
      {
        scope: "/",
        updateViaCache: "none",
      },
    );
    const activeRegistration =
      await waitForServiceWorkerActivation(registration);

    console.log("Service worker registered and activated:", {
      scriptURL: activeRegistration.active?.scriptURL,
      scope: activeRegistration.scope,
    });

    return activeRegistration;
  } catch (error) {
    console.error(
      "Explicit service worker registration failed for /next-pwa-sw.js:",
      error,
    );
    throw error;
  }
}

async function savePushSubscription(subscription: PushSubscription) {
  const serializedSubscription = subscription.toJSON();
  const endpoint = serializedSubscription.endpoint ?? subscription.endpoint;
  const authKey = serializedSubscription.keys?.auth;
  const p256dhKey = serializedSubscription.keys?.p256dh;

  if (!endpoint || !authKey || !p256dhKey) {
    const keyError = new Error(
      "The browser subscription is missing its endpoint or encryption keys.",
    );
    console.error("Push subscription could not be serialized:", keyError);
    throw keyError;
  }

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error(
      "Push subscription authentication check failed:",
      authError,
    );
    throw authError;
  }

  if (!user) {
    const missingUserError = new Error(
      "No authenticated Supabase user is available. Select your profile again.",
    );
    console.error(
      "Push subscription authentication check failed:",
      missingUserError,
    );
    throw missingUserError;
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      auth_key: authKey,
      p256dh_key: p256dhKey,
    },
    {
      onConflict: "endpoint",
    },
  );

  if (error) {
    console.error("Push subscription Supabase upsert failed:", error);
    throw error;
  }

  console.log("Push subscription saved to Supabase:", {
    endpoint,
    userId: user.id,
  });
}

async function removePushSubscription(endpoint: string) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    console.error(
      "Push subscription authentication check failed before delete:",
      authError,
    );
    throw authError;
  }

  if (!user) {
    const missingUserError = new Error(
      "No authenticated Supabase user is available. Select your profile again.",
    );
    console.error(
      "Push subscription authentication check failed before delete:",
      missingUserError,
    );
    throw missingUserError;
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint)
    .eq("user_id", user.id);

  if (error) {
    console.error("Push subscription Supabase delete failed:", error);
    throw error;
  }

  console.log("Push subscription removed from Supabase:", { endpoint });
}

function getPushStatusCopy(status: PushStatus) {
  switch (status) {
    case "subscribed":
      return {
        title: "Notifications are on",
        detail: "This device is subscribed to household updates.",
      };
    case "denied":
      return {
        title: "Permission is blocked",
        detail: "Enable notifications for this app in your device settings.",
      };
    case "missing-key":
      return {
        title: "VAPID key required",
        detail: "Add NEXT_PUBLIC_VAPID_KEY to the app environment.",
      };
    case "unsupported":
      return {
        title: "Not supported here",
        detail: "On iPhone, install the app to the Home Screen first.",
      };
    case "error":
      return {
        title: "Subscription unavailable",
        detail: "The device could not finish the notification setup.",
      };
    case "checking":
      return {
        title: "Checking this device",
        detail: "Reading the current notification subscription.",
      };
    default:
      return {
        title: "Notifications are off",
        detail: "Enable alerts for completed and upcoming chores.",
      };
  }
}

export default function SettingsPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [chores, setChores] = useState<Chore[]>([]);
  const [isLoadingChores, setIsLoadingChores] = useState(true);
  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");
  const [pushSubscription, setPushSubscription] =
    useState<PushSubscription | null>(null);
  const [isUpdatingPush, setIsUpdatingPush] = useState(false);
  const [isResettingScores, setIsResettingScores] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const showNotice = useCallback(
    (message: string, tone: Notice["tone"] = "error") => {
      setNotice({ id: Date.now(), message, tone });
    },
    [],
  );

  const loadChores = useCallback(async () => {
    const { data, error } = await supabase
      .from("chores")
      .select(choreSelect)
      .order("name", { ascending: true });

    if (error) {
      showNotice(error.message);
    } else {
      setChores(data ?? []);
    }

    setIsLoadingChores(false);
  }, [showNotice]);

  const inspectPushSubscription = useCallback(async () => {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      console.error(
        "Push subscription check failed: Service Worker, PushManager, or Notification API is unsupported.",
      );
      setPushStatus("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      console.error(
        "Push subscription check failed: notification permission is denied.",
      );
      setPushStatus("denied");
      return;
    }

    try {
      const registration = await withTimeout(
        getPushRegistration(),
        20_000,
        "Service worker registration",
      );
      const subscription = await withTimeout(
        registration.pushManager.getSubscription(),
        10_000,
        "Existing push subscription lookup",
      );

      setPushSubscription(subscription);

      if (subscription) {
        await withTimeout(
          savePushSubscription(subscription),
          15_000,
          "Existing subscription Supabase upsert",
        );
        window.localStorage.setItem(
          pushSubscriptionStorageKey,
          JSON.stringify(subscription.toJSON()),
        );
        setPushStatus("subscribed");
      } else if (!process.env.NEXT_PUBLIC_VAPID_KEY) {
        console.error(
          "Push subscription check failed: NEXT_PUBLIC_VAPID_KEY is missing.",
        );
        setPushStatus("missing-key");
      } else {
        setPushStatus("unsubscribed");
      }
    } catch (error) {
      console.error("Push subscription inspection failed:", error);
      setPushStatus("error");
    }
  }, []);

  useEffect(() => {
    const selectedProfileId = getSelectedProfileId();

    if (!selectedProfileId) {
      router.replace("/login");
      return;
    }

    Promise.resolve().then(() =>
      Promise.all([loadChores(), inspectPushSubscription()]),
    );

    const channel = supabase
      .channel("settings-chores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chores" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deleted = payload.old as Pick<Chore, "id">;
            setChores((current) =>
              current.filter((chore) => chore.id !== deleted.id),
            );
            return;
          }

          const changed = payload.new as Chore;
          setChores((current) => upsertChore(current, changed));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [inspectPushSubscription, loadChores, router]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function togglePushNotifications() {
    if (isUpdatingPush) {
      return;
    }

    setIsUpdatingPush(true);

    try {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        console.error(
          "Push subscription failed: Service Worker, PushManager, or Notification API is unsupported.",
        );
        setPushStatus("unsupported");
        showNotice("Push notifications are not supported on this device.");
        return;
      }

      if (pushSubscription) {
        const endpoint = pushSubscription.endpoint;
        let unsubscribed: boolean;

        try {
          unsubscribed = await withTimeout(
            pushSubscription.unsubscribe(),
            10_000,
            "Browser push unsubscription",
          );
        } catch (error) {
          console.error("PushManager unsubscribe failed:", error);
          throw error;
        }

        if (!unsubscribed) {
          const unsubscribeError = new Error(
            "The browser subscription could not be removed.",
          );
          console.error("PushManager unsubscribe failed:", unsubscribeError);
          throw unsubscribeError;
        }

        try {
          await withTimeout(
            removePushSubscription(endpoint),
            15_000,
            "Supabase subscription delete",
          );
        } catch (error) {
          console.error("Supabase subscription delete failed:", error);
          throw error;
        }

        window.localStorage.removeItem(pushSubscriptionStorageKey);
        setPushSubscription(null);
        setPushStatus("unsubscribed");
        showNotice("Notifications disabled on this device.", "success");
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_KEY;

      if (!vapidKey) {
        console.error(
          "Push subscription failed: NEXT_PUBLIC_VAPID_KEY is missing.",
        );
        setPushStatus("missing-key");
        showNotice("The public VAPID key is missing.");
        return;
      }

      let permission: NotificationPermission;

      try {
        permission = await withTimeout(
          Notification.requestPermission(),
          60_000,
          "Notification permission request",
        );
      } catch (error) {
        console.error("Notification.requestPermission failed:", error);
        throw error;
      }

      if (permission !== "granted") {
        console.error(
          `Push subscription stopped: notification permission is ${permission}.`,
        );
        setPushStatus(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }

      let registration: ServiceWorkerRegistration;

      try {
        registration = await withTimeout(
          getPushRegistration(),
          20_000,
          "Explicit service worker registration and activation",
        );
      } catch (error) {
        console.error(
          "Explicit service worker registration failed before PushManager.subscribe:",
          error,
        );
        throw error;
      }

      let subscription: PushSubscription;

      try {
        subscription = await withTimeout(
          registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidKey),
          }),
          20_000,
          "PushManager.subscribe",
        );
      } catch (error) {
        console.error("PushManager.subscribe failed:", error);
        throw error;
      }

      try {
        await withTimeout(
          savePushSubscription(subscription),
          15_000,
          "Supabase subscription upsert",
        );
      } catch (error) {
        console.error("Supabase subscription insert/upsert failed:", error);
        throw error;
      }

      window.localStorage.setItem(
        pushSubscriptionStorageKey,
        JSON.stringify(subscription.toJSON()),
      );
      setPushSubscription(subscription);
      setPushStatus("subscribed");
      showNotice("Notifications enabled on this device.", "success");
    } catch (error) {
      console.error("Push notification toggle failed:", error);
      setPushStatus("error");
      showNotice(
        error instanceof Error
          ? error.message
          : "Notification setup could not be completed.",
      );
    } finally {
      console.log("Push notification toggle finished; clearing loading state.");
      setIsUpdatingPush(false);
    }
  }

  async function deleteChore(chore: Chore) {
    setChores((current) =>
      current.filter((currentChore) => currentChore.id !== chore.id),
    );

    const { error } = await supabase
      .from("chores")
      .delete()
      .eq("id", chore.id);

    if (error) {
      setChores((current) => upsertChore(current, chore));
      showNotice(error.message);
    } else {
      showNotice(`${chore.name} deleted.`, "success");
    }
  }

  async function resetAllScores() {
    const confirmed = window.confirm(
      "Reset every household member's score to zero? This cannot be undone.",
    );

    if (!confirmed) {
      return;
    }

    setIsResettingScores(true);

    const { error } = await supabase
      .from("profiles")
      .update({ points: 0 })
      .not("id", "is", null);

    if (error) {
      showNotice(error.message);
    } else {
      showNotice("All household scores were reset.", "success");
    }

    setIsResettingScores(false);
  }

  const pushCopy = getPushStatusCopy(pushStatus);
  const pushToggleDisabled =
    pushStatus === "checking" ||
    pushStatus === "unsupported" ||
    pushStatus === "missing-key" ||
    pushStatus === "denied" ||
    isUpdatingPush;

  return (
    <main className="dashboard-surface min-h-[100svh] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <motion.header
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-4"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <p className="text-sm font-medium text-cyan-200">Household</p>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
              Settings
            </h1>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-400 shadow-[0_16px_45px_rgba(0,0,0,0.3)] backdrop-blur-xl">
            <SettingsIcon aria-hidden="true" size={21} />
          </div>
        </motion.header>

        <Link
          className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          href="/"
        >
          <ArrowLeft aria-hidden="true" size={17} />
          Back to Dashboard
        </Link>

        <div className="mt-8 space-y-5">
          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-950/70 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            transition={{
              delay: reduceMotion ? 0 : 0.05,
              duration: 0.38,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="flex items-center gap-4 p-5 sm:p-6">
              <div
                className={`flex size-11 shrink-0 items-center justify-center rounded-2xl border ${
                  pushStatus === "subscribed"
                    ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-200"
                    : "border-white/[0.08] bg-white/[0.04] text-zinc-500"
                }`}
              >
                {pushStatus === "subscribed" ? (
                  <Bell aria-hidden="true" size={20} />
                ) : (
                  <BellOff aria-hidden="true" size={20} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-zinc-100">
                  Push Notifications
                </h2>
                <p className="mt-1 text-sm leading-5 text-zinc-500">
                  {pushCopy.title}
                </p>
              </div>
              <motion.button
                aria-checked={pushStatus === "subscribed"}
                aria-label="Toggle push notifications"
                className={`relative h-8 w-14 shrink-0 rounded-full border p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 ${
                  pushStatus === "subscribed"
                    ? "border-cyan-200/30 bg-cyan-300"
                    : "border-white/10 bg-zinc-800"
                }`}
                disabled={pushToggleDisabled}
                onClick={() => void togglePushNotifications()}
                role="switch"
                type="button"
                whileTap={reduceMotion ? undefined : { scale: 0.95 }}
              >
                <motion.span
                  animate={{
                    x: pushStatus === "subscribed" ? 24 : 0,
                  }}
                  className="flex size-6 items-center justify-center rounded-full bg-white text-zinc-950 shadow-md"
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  {isUpdatingPush || pushStatus === "checking" ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin"
                      size={12}
                    />
                  ) : null}
                </motion.span>
              </motion.button>
            </div>
            <div className="border-t border-white/[0.06] px-5 py-4 sm:px-6">
              <p className="text-xs leading-5 text-zinc-600">
                {pushCopy.detail}
              </p>
            </div>
          </motion.section>

          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-black shadow-[0_20px_60px_rgba(0,0,0,0.28)]"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            transition={{
              delay: reduceMotion ? 0 : 0.1,
              duration: 0.38,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="flex items-center justify-between gap-4 p-5 sm:p-6">
              <div>
                <p className="text-xs font-medium uppercase text-zinc-500">
                  Admin
                </p>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  Manage Chores
                </h2>
              </div>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1.5 font-mono text-xs text-zinc-500">
                {chores.length}
              </span>
            </div>

            <div className="border-t border-white/[0.06]">
              {isLoadingChores ? (
                <div className="flex min-h-36 items-center justify-center text-zinc-600">
                  <LoaderCircle
                    aria-label="Loading chores"
                    className="animate-spin"
                    size={22}
                  />
                </div>
              ) : chores.length === 0 ? (
                <div className="flex min-h-36 flex-col items-center justify-center px-5 text-center">
                  <Clock3 aria-hidden="true" className="text-zinc-700" size={23} />
                  <p className="mt-3 text-sm text-zinc-500">
                    No chores to manage.
                  </p>
                </div>
              ) : (
                <motion.ul layout>
                  <AnimatePresence initial={false}>
                    {chores.map((chore) => (
                      <motion.li
                        animate={{ opacity: 1, height: "auto" }}
                        className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4 last:border-b-0 sm:px-6"
                        exit={{ opacity: 0, height: 0, paddingBlock: 0 }}
                        initial={false}
                        key={chore.id}
                        layout
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-zinc-500">
                          {chore.is_paused ? (
                            <AlarmClock aria-hidden="true" size={17} />
                          ) : (
                            <Clock3 aria-hidden="true" size={17} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-200">
                            {chore.name}
                          </p>
                          <p className="mt-1 text-xs text-zinc-600">
                            Every {formatDuration(chore.interval_minutes)}
                            {chore.is_paused ? " · Paused" : ""}
                          </p>
                        </div>
                        <motion.button
                          aria-label={`Delete ${chore.name}`}
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-rose-300/10 bg-rose-400/[0.05] text-rose-400 transition-colors hover:border-rose-300/20 hover:bg-rose-400/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                          onClick={() => void deleteChore(chore)}
                          title={`Delete ${chore.name}`}
                          type="button"
                          whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                        >
                          <Trash2 aria-hidden="true" size={17} />
                        </motion.button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              )}
            </div>
          </motion.section>

          <motion.section
            animate={{ opacity: 1, y: 0 }}
            className="rounded-3xl border border-rose-300/15 bg-gradient-to-br from-rose-950/30 via-zinc-950 to-black p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] sm:p-6"
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            transition={{
              delay: reduceMotion ? 0 : 0.15,
              duration: 0.38,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="flex items-start gap-4">
              <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-rose-300/15 bg-rose-300/[0.07] text-rose-300">
                <RotateCcw aria-hidden="true" size={19} />
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-rose-300/70">
                  Score controls
                </p>
                <h2 className="mt-1 text-xl font-semibold text-white">
                  Reset the leaderboard
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  Set every household member back to zero points.
                </p>
              </div>
            </div>
            <motion.button
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-4 font-semibold text-rose-100 transition-colors hover:bg-rose-400/15 disabled:cursor-wait disabled:opacity-50"
              disabled={isResettingScores}
              onClick={() => void resetAllScores()}
              type="button"
              whileTap={reduceMotion ? undefined : { scale: 0.985 }}
            >
              {isResettingScores ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin"
                  size={18}
                />
              ) : (
                <RotateCcw aria-hidden="true" size={18} />
              )}
              Reset All Scores
            </motion.button>
          </motion.section>
        </div>
      </div>

      <AnimatePresence>
        {notice ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur-xl ${
              notice.tone === "error"
                ? "border-rose-300/20 bg-rose-950/90 text-rose-100"
                : "border-emerald-300/20 bg-emerald-950/90 text-emerald-100"
            }`}
            exit={{ opacity: 0, y: 8 }}
            initial={{ opacity: 0, y: 12 }}
            key={notice.id}
          >
            {notice.tone === "error" ? (
              <CircleAlert aria-hidden="true" className="shrink-0" size={18} />
            ) : (
              <Check aria-hidden="true" className="shrink-0" size={18} />
            )}
            <p className="min-w-0 flex-1 text-sm">{notice.message}</p>
            <button
              aria-label="Dismiss"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-current opacity-60 hover:bg-white/10 hover:opacity-100"
              onClick={() => setNotice(null)}
              type="button"
            >
              <X aria-hidden="true" size={15} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
