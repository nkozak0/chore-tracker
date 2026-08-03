"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlarmClock,
  Check,
  CircleAlert,
  Hand,
  ListChecks,
  LoaderCircle,
  LogOut,
  MessageSquareText,
  Moon,
  Plus,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Trophy,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/app/components/profile-avatar";
import {
  clearSelectedProfile,
  getSelectedProfileId,
} from "@/lib/session";
import { supabase } from "@/lib/supabaseClient";
import type {
  Chore,
  ChoreHistory,
  Profile,
} from "@/lib/supabaseClient";

const choreSelect =
  "id, name, interval_minutes, snooze_minutes, next_due_at, is_paused, last_completed_by, claimed_by" as const;
const profileSelect = "id, display_name, avatar_color, points" as const;
const historySelect =
  "id, chore_id, profile_id, action_type, note, created_at" as const;
const legacyHistorySelect =
  "id, chore_id, profile_id, action_type, created_at" as const;

type ChoreForm = {
  name: string;
  intervalMinutes: string;
  snoozeMinutes: string;
};

type Notice = {
  id: number;
  message: string;
  tone: "error" | "success";
};

function sortChores(items: Chore[]) {
  return [...items].sort((first, second) => {
    if (first.is_paused !== second.is_paused) {
      return first.is_paused ? 1 : -1;
    }

    return (
      new Date(first.next_due_at).getTime() -
      new Date(second.next_due_at).getTime()
    );
  });
}

function sortHistory(items: ChoreHistory[]) {
  return [...items]
    .sort(
      (first, second) =>
        new Date(second.created_at).getTime() -
        new Date(first.created_at).getTime(),
    )
    .slice(0, 40);
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const exists = items.some((item) => item.id === nextItem.id);

  return exists
    ? items.map((item) => (item.id === nextItem.id ? nextItem : item))
    : [...items, nextItem];
}

function formatCountdown(nextDueAt: string, now: number) {
  const totalMs = new Date(nextDueAt).getTime() - now;

  if (totalMs <= 0) {
    return { label: "Due now", isDue: true };
  }

  const totalSeconds = Math.floor(totalMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return {
    label: days > 0 ? `${days}d ${clock}` : clock,
    isDue: false,
  };
}

function formatRelativeTime(createdAt: string, now: number) {
  const deltaSeconds = Math.round(
    (new Date(createdAt).getTime() - now) / 1000,
  );
  const formatter = new Intl.RelativeTimeFormat("en", {
    numeric: "auto",
    style: "short",
  });

  if (Math.abs(deltaSeconds) < 60) {
    return formatter.format(deltaSeconds, "second");
  }

  const deltaMinutes = Math.round(deltaSeconds / 60);

  if (Math.abs(deltaMinutes) < 60) {
    return formatter.format(deltaMinutes, "minute");
  }

  const deltaHours = Math.round(deltaMinutes / 60);

  if (Math.abs(deltaHours) < 24) {
    return formatter.format(deltaHours, "hour");
  }

  const deltaDays = Math.round(deltaHours / 24);

  if (Math.abs(deltaDays) < 30) {
    return formatter.format(deltaDays, "day");
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(createdAt));
}

function formatDuration(minutes: number) {
  if (minutes < 60) {
    return `${minutes}m`;
  }

  if (minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function getGreeting(now: number) {
  if (!now) {
    return "Welcome home";
  }

  const hour = new Date(now).getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 18) {
    return "Good afternoon";
  }

  return "Good evening";
}

function createHistoryEntry(
  choreId: string,
  profileId: string,
  actionType: string,
  note: string | null = null,
): ChoreHistory {
  return {
    id: crypto.randomUUID(),
    chore_id: choreId,
    profile_id: profileId,
    action_type: actionType,
    note,
    created_at: new Date().toISOString(),
  };
}

function toHistoryInsert(entry: ChoreHistory) {
  const baseEntry = {
    id: entry.id,
    chore_id: entry.chore_id,
    profile_id: entry.profile_id,
    action_type: entry.action_type,
    created_at: entry.created_at,
  };

  return entry.note ? { ...baseEntry, note: entry.note } : baseEntry;
}

function actionCopy(actionType: string) {
  switch (actionType) {
    case "completed":
    case "complete":
      return { verb: "completed", Icon: Check, color: "text-emerald-300" };
    case "claimed":
    case "claim":
      return { verb: "claimed", Icon: Hand, color: "text-cyan-300" };
    case "snoozed":
    case "snooze":
      return { verb: "snoozed", Icon: AlarmClock, color: "text-amber-300" };
    case "paused":
      return { verb: "put to sleep", Icon: Moon, color: "text-violet-300" };
    case "resumed":
      return { verb: "woke", Icon: Sun, color: "text-orange-300" };
    default:
      return {
        verb: actionType.replaceAll("_", " "),
        Icon: Activity,
        color: "text-zinc-400",
      };
  }
}

type ChoreCardProps = {
  chore: Chore;
  currentProfile: Profile;
  profilesById: Map<string, Profile>;
  now: number;
  pendingAction?: string;
  onClaim: (chore: Chore) => void;
  onComplete: (chore: Chore) => void;
  onSnooze: (chore: Chore) => void;
  onTogglePaused: (chore: Chore) => void;
};

function ChoreCard({
  chore,
  currentProfile,
  profilesById,
  now,
  pendingAction,
  onClaim,
  onComplete,
  onSnooze,
  onTogglePaused,
}: ChoreCardProps) {
  const reduceMotion = useReducedMotion();
  const countdown = formatCountdown(chore.next_due_at, now);
  const claimedProfile = chore.claimed_by
    ? profilesById.get(chore.claimed_by)
    : null;
  const lastCompletedProfile = chore.last_completed_by
    ? profilesById.get(chore.last_completed_by)
    : null;
  const isClaimedByCurrent = chore.claimed_by === currentProfile.id;
  const isClaimedByOther =
    Boolean(chore.claimed_by) && !isClaimedByCurrent;
  const isPending = Boolean(pendingAction);
  const actionsDisabled =
    isPending || chore.is_paused || isClaimedByOther;

  return (
    <motion.article
      animate={{ opacity: 1, y: 0 }}
      className={`relative overflow-hidden rounded-3xl border bg-gradient-to-br p-5 shadow-[0_20px_60px_rgba(0,0,0,0.3)] sm:p-6 ${
        chore.is_paused
          ? "border-zinc-800 from-zinc-950/80 to-black opacity-75"
          : countdown.isDue
            ? "border-rose-400/25 from-rose-950/35 via-zinc-950 to-black"
            : "border-zinc-800 from-zinc-900 via-zinc-950 to-black"
      }`}
      initial={reduceMotion ? false : { opacity: 0, y: 18 }}
      layout
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        aria-hidden="true"
        className={`absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent to-transparent ${
          countdown.isDue ? "via-rose-300/60" : "via-cyan-300/35"
        }`}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-xl font-semibold text-white sm:text-2xl">
              {chore.name}
            </h3>
            {countdown.isDue && !chore.is_paused ? (
              <span className="rounded-full border border-rose-300/20 bg-rose-300/10 px-2 py-1 text-[11px] font-semibold uppercase text-rose-200">
                Due
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Every {formatDuration(chore.interval_minutes)}
          </p>
        </div>

        <motion.button
          aria-label={chore.is_paused ? "Wake chore" : "Put chore to sleep"}
          className={`flex size-10 shrink-0 items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
            chore.is_paused
              ? "border-orange-300/20 bg-orange-300/10 text-orange-200 hover:bg-orange-300/15"
              : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white"
          }`}
          disabled={isPending}
          onClick={() => onTogglePaused(chore)}
          title={chore.is_paused ? "Wake chore" : "Put chore to sleep"}
          type="button"
          whileTap={reduceMotion ? undefined : { scale: 0.9 }}
        >
          {pendingAction === "pause" ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
          ) : chore.is_paused ? (
            <Sun aria-hidden="true" size={18} />
          ) : (
            <Moon aria-hidden="true" size={18} />
          )}
        </motion.button>
      </div>

      <div className="mt-8">
        <p className="text-xs font-medium uppercase text-zinc-500">
          {chore.is_paused ? "Schedule paused" : "Time remaining"}
        </p>
        <p
          className={`mt-2 break-words font-mono text-4xl font-semibold tabular-nums sm:text-5xl ${
            chore.is_paused
              ? "text-zinc-600"
              : countdown.isDue
                ? "text-rose-100"
                : "text-zinc-50"
          }`}
        >
          {chore.is_paused ? "Sleeping" : countdown.label}
        </p>
      </div>

      <div className="mt-7 flex min-h-9 items-center">
        {claimedProfile ? (
          <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3">
            <ProfileAvatar
              className="size-6 text-[9px]"
              color={claimedProfile.avatar_color}
              name={claimedProfile.display_name}
            />
            <span className="truncate text-xs font-medium text-zinc-300">
              {isClaimedByCurrent
                ? "Claimed by you"
                : `Claimed by ${claimedProfile.display_name}`}
            </span>
          </div>
        ) : (
          <span className="text-xs text-zinc-600">Available to claim</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <motion.button
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isPending || chore.is_paused || Boolean(chore.claimed_by)}
          onClick={() => onClaim(chore)}
          type="button"
          whileTap={reduceMotion ? undefined : { scale: 0.975 }}
        >
          {pendingAction === "claim" ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
          ) : (
            <Hand aria-hidden="true" size={16} />
          )}
          {isClaimedByCurrent ? "Claimed" : "Claim"}
        </motion.button>

        <motion.button
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[0.07] px-3 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-300/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={() => onSnooze(chore)}
          type="button"
          whileTap={reduceMotion ? undefined : { scale: 0.975 }}
        >
          {pendingAction === "snooze" ? (
            <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
          ) : (
            <AlarmClock aria-hidden="true" size={16} />
          )}
          {formatDuration(chore.snooze_minutes)}
        </motion.button>
      </div>

      <motion.button
        className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 font-semibold text-zinc-950 shadow-[0_10px_35px_rgba(34,211,238,0.12)] transition-colors hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
        disabled={actionsDisabled}
        onClick={() => onComplete(chore)}
        type="button"
        whileTap={reduceMotion ? undefined : { scale: 0.985 }}
      >
        {pendingAction === "complete" ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" size={18} />
        ) : (
          <Check aria-hidden="true" size={19} strokeWidth={2.4} />
        )}
        Complete
      </motion.button>

      {lastCompletedProfile ? (
        <p className="mt-4 truncate text-xs text-zinc-600">
          Last completed by {lastCompletedProfile.display_name}
        </p>
      ) : null}
    </motion.article>
  );
}

type ActivityFeedProps = {
  history: ChoreHistory[];
  profilesById: Map<string, Profile>;
  choresById: Map<string, Chore>;
  now: number;
};

function ActivityFeed({
  history,
  profilesById,
  choresById,
  now,
}: ActivityFeedProps) {
  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950/70 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            Household
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">
            Recent activity
          </h2>
        </div>
        <Activity aria-hidden="true" className="text-zinc-600" size={19} />
      </div>

      <div className="mt-5 max-h-[430px] overflow-y-auto pr-1">
        {history.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center text-center">
            <ListChecks aria-hidden="true" className="text-zinc-700" size={25} />
            <p className="mt-3 text-sm text-zinc-500">
              Activity will appear here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {history.slice(0, 16).map((entry) => {
              const profile = profilesById.get(entry.profile_id);
              const chore = choresById.get(entry.chore_id);
              const { Icon, color, verb } = actionCopy(entry.action_type);

              return (
                <li className="flex gap-3 py-3.5 first:pt-0" key={entry.id}>
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035]">
                    <Icon aria-hidden="true" className={color} size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5 text-zinc-300">
                      <span className="font-semibold text-zinc-100">
                        {profile?.display_name ?? "Someone"}
                      </span>{" "}
                      {verb}{" "}
                      <span className="font-medium text-zinc-400">
                        {chore?.name ?? "a chore"}
                      </span>
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {formatRelativeTime(entry.created_at, now)}
                    </p>
                    {entry.note &&
                    (entry.action_type === "completed" ||
                      entry.action_type === "complete") ? (
                      <div className="mt-3 flex gap-2 rounded-2xl border border-cyan-200/10 bg-cyan-200/[0.045] px-3 py-2.5">
                        <MessageSquareText
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-cyan-300/70"
                          size={14}
                        />
                        <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-400">
                          {entry.note}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

type LeaderboardProps = {
  profiles: Profile[];
  currentProfileId: string;
};

function Leaderboard({ profiles, currentProfileId }: LeaderboardProps) {
  const rankedProfiles = [...profiles].sort(
    (first, second) => second.points - first.points,
  );

  return (
    <section className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-900 to-black p-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)] sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">
            This household
          </p>
          <h2 className="mt-1 text-xl font-semibold text-white">Leaderboard</h2>
        </div>
        <Trophy aria-hidden="true" className="text-amber-300" size={19} />
      </div>

      <ol className="mt-5 space-y-2">
        {rankedProfiles.map((profile, index) => (
          <li
            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${
              profile.id === currentProfileId
                ? "border-cyan-300/20 bg-cyan-300/[0.06]"
                : "border-transparent bg-white/[0.025]"
            }`}
            key={profile.id}
          >
            <span
              className={`w-5 text-center text-xs font-semibold ${
                index === 0 ? "text-amber-300" : "text-zinc-600"
              }`}
            >
              {index + 1}
            </span>
            <ProfileAvatar
              className="size-8 text-[11px]"
              color={profile.avatar_color}
              name={profile.display_name}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
              {profile.display_name}
            </span>
            <span className="font-mono text-sm font-semibold tabular-nums text-zinc-300">
              {profile.points}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Dashboard() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [chores, setChores] = useState<Chore[]>([]);
  const [history, setHistory] = useState<ChoreHistory[]>([]);
  const [now, setNow] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "live"
  >("connecting");
  const [pendingActions, setPendingActions] = useState<
    Record<string, string>
  >({});
  const [completionChore, setCompletionChore] = useState<Chore | null>(null);
  const [completionNote, setCompletionNote] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [form, setForm] = useState<ChoreForm>({
    name: "",
    intervalMinutes: "180",
    snoozeMinutes: "60",
  });

  const showNotice = useCallback(
    (message: string, tone: Notice["tone"] = "error") => {
      setNotice({ id: Date.now(), message, tone });
    },
    [],
  );

  const loadDashboard = useCallback(
    async (selectedProfileId: string) => {
      const [choresResult, profilesResult, initialHistoryResult] =
        await Promise.all([
        supabase
          .from("chores")
          .select(choreSelect)
          .order("next_due_at", { ascending: true }),
        supabase
          .from("profiles")
          .select(profileSelect)
          .order("points", { ascending: false }),
        supabase
          .from("chore_history")
          .select(historySelect)
          .order("created_at", { ascending: false })
          .limit(40),
      ]);

      let historyData = initialHistoryResult.data;
      let historyError = initialHistoryResult.error;

      if (
        historyError?.code === "42703" &&
        historyError.message.includes("note")
      ) {
        const legacyHistoryResult = await supabase
          .from("chore_history")
          .select(legacyHistorySelect)
          .order("created_at", { ascending: false })
          .limit(40);

        historyError = legacyHistoryResult.error;
        historyData =
          legacyHistoryResult.data?.map((entry) => ({
            ...entry,
            note: null,
          })) ?? null;
      }

      const loadError =
        choresResult.error ?? profilesResult.error ?? historyError;

      if (loadError) {
        showNotice(loadError.message);
        setIsLoading(false);
        return;
      }

      const nextProfiles = profilesResult.data ?? [];

      if (!nextProfiles.some((profile) => profile.id === selectedProfileId)) {
        clearSelectedProfile();
        router.replace("/login");
        return;
      }

      setChores(sortChores(choresResult.data ?? []));
      setProfiles(nextProfiles);
      setHistory(sortHistory(historyData ?? []));
      setIsLoading(false);
    },
    [router, showNotice],
  );

  useEffect(() => {
    const selectedProfileId = getSelectedProfileId();

    if (!selectedProfileId) {
      router.replace("/login");
      return;
    }

    queueMicrotask(() => setProfileId(selectedProfileId));
  }, [router]);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    Promise.resolve().then(() => loadDashboard(profileId));

    const channel = supabase
      .channel("household-dashboard")
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
          setChores((current) =>
            sortChores(upsertById(current, changed)),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deleted = payload.old as Pick<Profile, "id">;

            if (deleted.id === profileId) {
              clearSelectedProfile();
              router.replace("/login");
            }

            setProfiles((current) =>
              current.filter((profile) => profile.id !== deleted.id),
            );
            return;
          }

          const changed = payload.new as Profile;
          setProfiles((current) => upsertById(current, changed));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chore_history" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const deleted = payload.old as Pick<ChoreHistory, "id">;
            setHistory((current) =>
              current.filter((entry) => entry.id !== deleted.id),
            );
            return;
          }

          const changed = payload.new as ChoreHistory;
          setHistory((current) =>
            sortHistory(upsertById(current, changed)),
          );
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnectionStatus("live");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadDashboard, profileId, router]);

  useEffect(() => {
    const syncNow = () => setNow(Date.now());
    const firstTick = window.setTimeout(syncNow, 0);
    const interval = window.setInterval(syncNow, 1000);

    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!completionChore) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [completionChore]);

  const profilesById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const choresById = useMemo(
    () => new Map(chores.map((chore) => [chore.id, chore])),
    [chores],
  );
  const currentProfile = profileId ? profilesById.get(profileId) : undefined;
  const dueCount = useMemo(
    () =>
      chores.filter(
        (chore) =>
          !chore.is_paused &&
          new Date(chore.next_due_at).getTime() <= now,
      ).length,
    [chores, now],
  );

  function setPending(choreId: string, action: string | null) {
    setPendingActions((current) => {
      if (action) {
        return { ...current, [choreId]: action };
      }

      const next = { ...current };
      delete next[choreId];
      return next;
    });
  }

  function patchChore(choreId: string, patch: Partial<Chore>) {
    setChores((current) =>
      sortChores(
        current.map((chore) =>
          chore.id === choreId ? { ...chore, ...patch } : chore,
        ),
      ),
    );
  }

  function addOptimisticHistory(entry: ChoreHistory) {
    setHistory((current) => sortHistory(upsertById(current, entry)));
  }

  async function reconcileAfterError(message: string) {
    showNotice(message);
    if (profileId) {
      await loadDashboard(profileId);
    }
  }

  async function claimChore(chore: Chore) {
    if (!profileId || chore.claimed_by || chore.is_paused) {
      return;
    }

    const entry = createHistoryEntry(chore.id, profileId, "claimed");
    patchChore(chore.id, { claimed_by: profileId });
    addOptimisticHistory(entry);
    setPending(chore.id, "claim");

    const [choreResult, historyResult] = await Promise.all([
      supabase
        .from("chores")
        .update({ claimed_by: profileId })
        .eq("id", chore.id),
      supabase.from("chore_history").insert(toHistoryInsert(entry)),
    ]);

    if (choreResult.error || historyResult.error) {
      await reconcileAfterError(
        choreResult.error?.message ??
          historyResult.error?.message ??
          "The chore could not be claimed.",
      );
    }

    setPending(chore.id, null);
  }

  async function snoozeChore(chore: Chore) {
    if (!profileId || chore.is_paused) {
      return;
    }

    const nextDueAt = new Date(
      new Date(chore.next_due_at).getTime() +
        chore.snooze_minutes * 60 * 1000,
    ).toISOString();
    const entry = createHistoryEntry(chore.id, profileId, "snoozed");

    patchChore(chore.id, { next_due_at: nextDueAt });
    addOptimisticHistory(entry);
    setPending(chore.id, "snooze");

    const [choreResult, historyResult] = await Promise.all([
      supabase
        .from("chores")
        .update({ next_due_at: nextDueAt })
        .eq("id", chore.id),
      supabase.from("chore_history").insert(toHistoryInsert(entry)),
    ]);

    if (choreResult.error || historyResult.error) {
      await reconcileAfterError(
        choreResult.error?.message ??
          historyResult.error?.message ??
          "The chore could not be snoozed.",
      );
    }

    setPending(chore.id, null);
  }

  async function togglePaused(chore: Chore) {
    if (!profileId) {
      return;
    }

    const nextPausedState = !chore.is_paused;
    const patch = {
      is_paused: nextPausedState,
      ...(nextPausedState ? { claimed_by: null } : {}),
    };
    const entry = createHistoryEntry(
      chore.id,
      profileId,
      nextPausedState ? "paused" : "resumed",
    );

    patchChore(chore.id, patch);
    addOptimisticHistory(entry);
    setPending(chore.id, "pause");

    const [choreResult, historyResult] = await Promise.all([
      supabase.from("chores").update(patch).eq("id", chore.id),
      supabase.from("chore_history").insert(toHistoryInsert(entry)),
    ]);

    if (choreResult.error || historyResult.error) {
      await reconcileAfterError(
        choreResult.error?.message ??
          historyResult.error?.message ??
          "The schedule could not be updated.",
      );
    }

    setPending(chore.id, null);
  }

  function requestCompletion(chore: Chore) {
    setCompletionNote("");
    setCompletionChore(chore);
  }

  function finalizeCompletion(note: string) {
    if (!completionChore) {
      return;
    }

    const chore = completionChore;
    setCompletionChore(null);
    setCompletionNote("");
    void completeChore(chore, note);
  }

  async function completeChore(chore: Chore, note: string) {
    if (!profileId || !currentProfile || chore.is_paused) {
      return;
    }

    const nextDueAt = new Date(
      Date.now() + chore.interval_minutes * 60 * 1000,
    ).toISOString();
    const nextPoints = currentProfile.points + 10;
    const trimmedNote = note.trim();
    const entry = createHistoryEntry(
      chore.id,
      profileId,
      "completed",
      trimmedNote || null,
    );
    const chorePatch = {
      next_due_at: nextDueAt,
      last_completed_by: profileId,
      claimed_by: null,
    };

    patchChore(chore.id, chorePatch);
    setProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId
          ? { ...profile, points: nextPoints }
          : profile,
      ),
    );
    addOptimisticHistory(entry);
    setPending(chore.id, "complete");

    const [choreResult, pointsResult, historyResult] = await Promise.all([
      supabase.from("chores").update(chorePatch).eq("id", chore.id),
      supabase
        .from("profiles")
        .update({ points: nextPoints })
        .eq("id", profileId),
      supabase.from("chore_history").insert(toHistoryInsert(entry)),
    ]);

    const mutationError =
      choreResult.error ?? pointsResult.error ?? historyResult.error;

    if (mutationError) {
      await reconcileAfterError(mutationError.message);
      setPending(chore.id, null);
      return;
    }

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session) {
        throw (
          sessionError ??
          new Error("The notification session has expired.")
        );
      }

      const response = await fetch("/api/send-push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          choreId: chore.id,
          choreName: chore.name,
          completedBy: profileId,
          nextDueAt,
        }),
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;

        throw new Error(
          result?.error ?? result?.message ?? "Push handoff failed",
        );
      }
    } catch (error) {
      console.error("Completion notification handoff failed:", error);
      showNotice(
        error instanceof Error
          ? `Completed, but notifications failed: ${error.message}`
          : "Completed, but the notification handoff did not respond.",
      );
    }

    setPending(chore.id, null);
  }

  async function createChore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = form.name.trim();
    const intervalMinutes = Number(form.intervalMinutes);
    const snoozeMinutes = Number(form.snoozeMinutes);

    if (!name || intervalMinutes <= 0 || snoozeMinutes <= 0) {
      showNotice("Enter a name and time values greater than zero.");
      return;
    }

    const optimisticChore: Chore = {
      id: crypto.randomUUID(),
      name,
      interval_minutes: intervalMinutes,
      snooze_minutes: snoozeMinutes,
      next_due_at: new Date(
        Date.now() + intervalMinutes * 60 * 1000,
      ).toISOString(),
      is_paused: false,
      last_completed_by: null,
      claimed_by: null,
    };

    setIsCreating(true);
    setChores((current) => sortChores([...current, optimisticChore]));
    setForm((current) => ({ ...current, name: "" }));

    const { error } = await supabase.from("chores").insert(optimisticChore);

    if (error) {
      setChores((current) =>
        current.filter((chore) => chore.id !== optimisticChore.id),
      );
      setForm((current) => ({ ...current, name }));
      showNotice(error.message);
    } else {
      showNotice("Chore added to the household.", "success");
    }

    setIsCreating(false);
  }

  function logout() {
    clearSelectedProfile();
    router.replace("/login");
  }

  if (isLoading || !currentProfile) {
    return (
      <main className="flex min-h-[100svh] items-center justify-center bg-[#07080a] text-zinc-500">
        <LoaderCircle
          aria-label="Loading household dashboard"
          className="animate-spin"
          size={28}
        />
      </main>
    );
  }

  return (
    <main className="dashboard-surface min-h-[100svh] px-3 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-white sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="sticky top-3 z-30 rounded-3xl border border-white/10 bg-zinc-950/75 px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:px-5">
          <div className="flex items-center gap-3">
            <ProfileAvatar
              className="size-11 text-sm"
              color={currentProfile.avatar_color}
              name={currentProfile.display_name}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-500">
                {getGreeting(now)}
              </p>
              <h1 className="truncate text-base font-semibold text-zinc-50 sm:text-lg">
                {currentProfile.display_name}
              </h1>
            </div>

            <div className="hidden items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3 py-2 sm:flex">
              <span
                className={`size-1.5 rounded-full ${
                  connectionStatus === "live"
                    ? "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]"
                    : "animate-pulse bg-amber-300"
                }`}
              />
              <span className="text-xs font-medium text-zinc-400">
                {connectionStatus === "live" ? "Live" : "Syncing"}
              </span>
            </div>

            <div className="flex items-center gap-2 rounded-2xl border border-amber-200/15 bg-gradient-to-br from-amber-200/[0.09] to-cyan-200/[0.05] px-3 py-2">
              <Sparkles
                aria-hidden="true"
                className="text-amber-300"
                size={15}
              />
              <span className="bg-gradient-to-r from-amber-200 via-yellow-300 to-cyan-200 bg-clip-text font-mono text-sm font-bold tabular-nums text-transparent sm:text-base">
                {currentProfile.points}
              </span>
              <span className="hidden text-xs text-zinc-500 sm:inline">pts</span>
            </div>

            <Link
              aria-label="Settings"
              className="flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              href="/settings"
              title="Settings"
            >
              <SettingsIcon aria-hidden="true" size={17} />
            </Link>

            <button
              aria-label="Log out"
              className="flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-zinc-500 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={logout}
              title="Log out"
              type="button"
            >
              <LogOut aria-hidden="true" size={17} />
            </button>
          </div>
        </header>

        <div className="mt-8 flex flex-col gap-2 px-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-cyan-200">Today at home</p>
            <h2 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
              Household rhythm
            </h2>
          </div>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <span>{chores.length} chores</span>
            <span className="size-1 rounded-full bg-zinc-700" />
            <span className={dueCount > 0 ? "text-rose-300" : ""}>
              {dueCount} due now
            </span>
          </div>
        </div>

        <div className="mt-6 grid items-start gap-5 xl:grid-cols-[minmax(0,1.75fr)_minmax(320px,0.8fr)]">
          <div className="min-w-0 space-y-5">
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/65 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-5">
              <form
                className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(120px,0.65fr)_minmax(120px,0.65fr)_auto] md:items-end"
                onSubmit={createChore}
              >
                <label className="grid gap-2 text-xs font-medium text-zinc-500">
                  Chore
                  <input
                    className="h-11 min-w-0 rounded-xl border border-white/[0.08] bg-black/35 px-3.5 text-sm text-white outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-300/40"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Add something to the rhythm"
                    type="text"
                    value={form.name}
                  />
                </label>
                <label className="grid gap-2 text-xs font-medium text-zinc-500">
                  Repeat, min
                  <input
                    className="h-11 min-w-0 rounded-xl border border-white/[0.08] bg-black/35 px-3.5 text-sm text-white outline-none transition-colors focus:border-cyan-300/40"
                    min="1"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        intervalMinutes: event.target.value,
                      }))
                    }
                    type="number"
                    value={form.intervalMinutes}
                  />
                </label>
                <label className="grid gap-2 text-xs font-medium text-zinc-500">
                  Snooze, min
                  <input
                    className="h-11 min-w-0 rounded-xl border border-white/[0.08] bg-black/35 px-3.5 text-sm text-white outline-none transition-colors focus:border-cyan-300/40"
                    min="1"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        snoozeMinutes: event.target.value,
                      }))
                    }
                    type="number"
                    value={form.snoozeMinutes}
                  />
                </label>
                <motion.button
                  aria-label="Add chore"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-50"
                  disabled={isCreating}
                  type="submit"
                  whileTap={reduceMotion ? undefined : { scale: 0.975 }}
                >
                  {isCreating ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="animate-spin"
                      size={17}
                    />
                  ) : (
                    <Plus aria-hidden="true" size={17} />
                  )}
                  Add
                </motion.button>
              </form>
            </section>

            {chores.length === 0 ? (
              <section className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-800 bg-black/20 px-6 text-center">
                <Users aria-hidden="true" className="text-zinc-700" size={28} />
                <h3 className="mt-4 text-lg font-semibold text-zinc-200">
                  A quiet household
                </h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                  Add the first recurring chore above.
                </p>
              </section>
            ) : (
              <motion.div
                className="grid gap-5 lg:grid-cols-2"
                layout
              >
                <AnimatePresence initial>
                  {chores.map((chore) => (
                    <ChoreCard
                      chore={chore}
                      currentProfile={currentProfile}
                      key={chore.id}
                      now={now}
                      onClaim={(selectedChore) =>
                        void claimChore(selectedChore)
                      }
                      onComplete={(selectedChore) =>
                        requestCompletion(selectedChore)
                      }
                      onSnooze={(selectedChore) =>
                        void snoozeChore(selectedChore)
                      }
                      onTogglePaused={(selectedChore) =>
                        void togglePaused(selectedChore)
                      }
                      pendingAction={pendingActions[chore.id]}
                      profilesById={profilesById}
                    />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </div>

          <aside className="grid gap-5 md:grid-cols-2 xl:sticky xl:top-24 xl:grid-cols-1">
            <ActivityFeed
              choresById={choresById}
              history={history}
              now={now}
              profilesById={profilesById}
            />
            <Leaderboard
              currentProfileId={currentProfile.id}
              profiles={profiles}
            />
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {completionChore ? (
          <motion.div
            animate={{ opacity: 1 }}
            aria-labelledby="completion-note-title"
            aria-modal="true"
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-3 backdrop-blur-md sm:items-center sm:p-6"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            role="dialog"
          >
            <motion.section
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-5 shadow-[0_30px_100px_rgba(0,0,0,0.7)] sm:p-6"
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 14, scale: 0.98 }
              }
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 22, scale: 0.97 }
              }
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <div
                aria-hidden="true"
                className="absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent"
              />

              <div className="flex items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/10 text-cyan-200 shadow-[0_10px_35px_rgba(34,211,238,0.08)]">
                  <MessageSquareText aria-hidden="true" size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-cyan-200">
                    {completionChore.name}
                  </p>
                  <h2
                    className="mt-1 text-xl font-semibold leading-7 text-white sm:text-2xl"
                    id="completion-note-title"
                  >
                    Thank you! Would you like to add any notes?
                  </h2>
                </div>
              </div>

              <label className="mt-6 grid gap-2 text-xs font-medium text-zinc-500">
                Note
                <textarea
                  autoFocus
                  className="min-h-28 w-full resize-none rounded-2xl border border-white/[0.08] bg-black/35 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-zinc-700 focus:border-cyan-300/40"
                  maxLength={500}
                  onChange={(event) => setCompletionNote(event.target.value)}
                  placeholder="Anything the household should know?"
                  value={completionNote}
                />
              </label>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <motion.button
                  className="h-11 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={() => finalizeCompletion("")}
                  type="button"
                  whileTap={reduceMotion ? undefined : { scale: 0.975 }}
                >
                  Skip
                </motion.button>
                <motion.button
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-zinc-950 shadow-[0_10px_35px_rgba(34,211,238,0.12)] transition-colors hover:bg-cyan-200"
                  onClick={() => finalizeCompletion(completionNote)}
                  type="button"
                  whileTap={reduceMotion ? undefined : { scale: 0.975 }}
                >
                  <Check aria-hidden="true" size={17} />
                  Save Note
                </motion.button>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>

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
