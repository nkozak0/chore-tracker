"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Chore } from "@/lib/supabaseClient";

type CountdownParts = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMs: number;
};

type ChoreForm = {
  name: string;
  intervalMinutes: string;
  snoozeMinutes: string;
};

const choreSelect =
  "id, name, interval_minutes, snooze_minutes, next_due_at" as const;

function sortChores(chores: Chore[]) {
  return [...chores].sort(
    (first, second) =>
      new Date(first.next_due_at).getTime() -
      new Date(second.next_due_at).getTime(),
  );
}

function getCountdownParts(nextDueAt: string, now: number): CountdownParts {
  const totalMs = new Date(nextDueAt).getTime() - now;
  const clampedMs = Math.max(0, totalMs);
  const totalSeconds = Math.floor(clampedMs / 1000);

  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalMs,
  };
}

function formatUnit(value: number) {
  return value.toString().padStart(2, "0");
}

function formatCountdown(countdown: CountdownParts) {
  if (countdown.days > 0) {
    return `${countdown.days}d ${formatUnit(countdown.hours)}h ${formatUnit(
      countdown.minutes,
    )}m ${formatUnit(countdown.seconds)}s`;
  }

  return `${formatUnit(countdown.hours)}:${formatUnit(
    countdown.minutes,
  )}:${formatUnit(countdown.seconds)}`;
}

function formatDueDate(nextDueAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(nextDueAt));
}

export default function Home() {
  const [chores, setChores] = useState<Chore[]>([]);
  const [form, setForm] = useState<ChoreForm>({
    name: "",
    intervalMinutes: "180",
    snoozeMinutes: "60",
  });
  const [now, setNow] = useState(0);
  const [status, setStatus] = useState("Syncing chores...");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyChoreId, setBusyChoreId] = useState<string | null>(null);

  const fetchChores = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("chores")
      .select(choreSelect)
      .order("next_due_at", { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      setStatus("Unable to load chores");
      return;
    }

    setChores(sortChores(data ?? []));
    setError(null);
    setStatus("Live and synced");
  }, []);

  useEffect(() => {
    Promise.resolve().then(fetchChores);

    const channel = supabase
      .channel("chores-dashboard")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chores" },
        (payload) => {
          const insertedChore = payload.new as Chore;

          setChores((current) => {
            const withoutDuplicate = current.filter(
              (chore) => chore.id !== insertedChore.id,
            );

            return sortChores([...withoutDuplicate, insertedChore]);
          });
          setStatus("Chore added");
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chores" },
        (payload) => {
          const updatedChore = payload.new as Chore;

          setChores((current) =>
            sortChores(
              current.map((chore) =>
                chore.id === updatedChore.id ? updatedChore : chore,
              ),
            ),
          );
          setStatus("Chore updated");
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "chores" },
        (payload) => {
          const deletedChore = payload.old as Pick<Chore, "id">;

          setChores((current) =>
            current.filter((chore) => chore.id !== deletedChore.id),
          );
          setStatus("Chore deleted");
        },
      )
      .subscribe((subscriptionStatus) => {
        if (subscriptionStatus === "SUBSCRIBED") {
          setStatus("Live and synced");
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchChores]);

  useEffect(() => {
    const syncNow = () => setNow(Date.now());
    const firstTick = window.setTimeout(syncNow, 0);
    const timer = window.setInterval(syncNow, 1000);

    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, []);

  const overdueCount = useMemo(
    () =>
      chores.filter((chore) => getCountdownParts(chore.next_due_at, now).totalMs <= 0)
        .length,
    [chores, now],
  );

  function updateForm(field: keyof ChoreForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createChore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = form.name.trim();
    const intervalMinutes = Number(form.intervalMinutes);
    const snoozeMinutes = Number(form.snoozeMinutes);

    if (!name || intervalMinutes <= 0 || snoozeMinutes <= 0) {
      setError("Add a name plus interval and snooze values greater than 0.");
      return;
    }

    setIsCreating(true);
    setError(null);

    const { data, error: insertError } = await supabase
      .from("chores")
      .insert({
        name,
        interval_minutes: intervalMinutes,
        snooze_minutes: snoozeMinutes,
        next_due_at: new Date(Date.now() + intervalMinutes * 60 * 1000).toISOString(),
      })
      .select(choreSelect)
      .single();

    if (insertError) {
      setError(insertError.message);
      setStatus("Create failed");
    } else {
      setChores((current) => sortChores([...current, data]));
      setForm((current) => ({ ...current, name: "" }));
      setStatus("Chore added");
    }

    setIsCreating(false);
  }

  async function shiftDueDate(chore: Chore, minutes: number, label: string) {
    setBusyChoreId(chore.id);
    setError(null);

    const nextDueAt = new Date(
      new Date(chore.next_due_at).getTime() + minutes * 60 * 1000,
    ).toISOString();

    const { data, error: updateError } = await supabase
      .from("chores")
      .update({ next_due_at: nextDueAt })
      .eq("id", chore.id)
      .select(choreSelect)
      .single();

    if (updateError) {
      setError(updateError.message);
      setStatus(`${label} failed`);
    } else {
      setChores((current) =>
        sortChores(
          current.map((currentChore) =>
            currentChore.id === chore.id ? data : currentChore,
          ),
        ),
      );
      setStatus(label);
    }

    setBusyChoreId(null);
  }

  async function deleteChore(chore: Chore) {
    setBusyChoreId(chore.id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("chores")
      .delete()
      .eq("id", chore.id);

    if (deleteError) {
      setError(deleteError.message);
      setStatus("Delete failed");
    } else {
      setChores((current) =>
        current.filter((currentChore) => currentChore.id !== chore.id),
      );
      setStatus("Chore deleted");
    }

    setBusyChoreId(null);
  }

  return (
    <main className="min-h-screen bg-[#050608] px-5 py-8 text-white sm:px-8">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-7">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-cyan-300">
              Chore Tracker
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-normal text-white sm:text-6xl">
              Dashboard
            </h1>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-zinc-300">
              {status}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-zinc-300">
              {chores.length} chores
            </span>
            <span className="rounded-full border border-rose-300/20 bg-rose-950/30 px-4 py-2 text-rose-100">
              {overdueCount} due
            </span>
          </div>
        </header>

        <form
          className="grid gap-4 rounded-[8px] border border-white/10 bg-zinc-950/80 p-5 shadow-2xl shadow-black/40 sm:grid-cols-[1.5fr_1fr_1fr_auto] sm:items-end"
          onSubmit={createChore}
        >
          <label className="grid gap-2 text-sm text-zinc-400">
            Name
            <input
              className="h-12 rounded-[8px] border border-white/10 bg-white/[0.04] px-4 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/70"
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="Clean kitchen"
              type="text"
              value={form.name}
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-400">
            Interval Time
            <input
              className="h-12 rounded-[8px] border border-white/10 bg-white/[0.04] px-4 text-base text-white outline-none transition focus:border-cyan-300/70"
              min="1"
              onChange={(event) =>
                updateForm("intervalMinutes", event.target.value)
              }
              type="number"
              value={form.intervalMinutes}
            />
          </label>
          <label className="grid gap-2 text-sm text-zinc-400">
            Snooze Time
            <input
              className="h-12 rounded-[8px] border border-white/10 bg-white/[0.04] px-4 text-base text-white outline-none transition focus:border-cyan-300/70"
              min="1"
              onChange={(event) =>
                updateForm("snoozeMinutes", event.target.value)
              }
              type="number"
              value={form.snoozeMinutes}
            />
          </label>
          <button
            className="h-12 rounded-[8px] bg-cyan-300 px-6 font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isCreating}
            type="submit"
          >
            {isCreating ? "Adding..." : "Add Chore"}
          </button>
        </form>

        {error ? (
          <p className="rounded-[8px] border border-rose-400/20 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        ) : null}

        {chores.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-white/15 bg-white/[0.03] px-6 py-14 text-center">
            <h2 className="text-2xl font-semibold text-white">
              No chores yet
            </h2>
            <p className="mt-2 text-zinc-400">
              Add your first chore above and the realtime dashboard will fill in.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {chores.map((chore) => {
              const countdown = getCountdownParts(chore.next_due_at, now);
              const isDue = countdown.totalMs <= 0;
              const isBusy = busyChoreId === chore.id;

              return (
                <article
                  className={`rounded-[8px] border p-5 shadow-2xl shadow-black/30 ${
                    isDue
                      ? "border-rose-300/25 bg-rose-950/20"
                      : "border-white/10 bg-zinc-950/80"
                  }`}
                  key={chore.id}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="truncate text-2xl font-semibold text-white">
                        {chore.name}
                      </h2>
                      <p className="mt-1 text-sm text-zinc-500">
                        Due {formatDueDate(chore.next_due_at)}
                      </p>
                    </div>
                    <button
                      className="rounded-[8px] border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-400 transition hover:border-rose-300/40 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => void deleteChore(chore)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="mt-7">
                    <p className="text-sm text-zinc-500">Time remaining</p>
                    <p
                      className={`mt-2 font-mono text-5xl font-semibold tabular-nums tracking-normal ${
                        isDue ? "text-rose-100" : "text-white"
                      }`}
                    >
                      {isDue ? "Due now" : formatCountdown(countdown)}
                    </p>
                  </div>

                  <div className="mt-7 grid grid-cols-2 gap-3 text-sm text-zinc-500">
                    <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-3">
                      Interval
                      <span className="mt-1 block text-base font-semibold text-zinc-200">
                        {chore.interval_minutes} min
                      </span>
                    </div>
                    <div className="rounded-[8px] border border-white/10 bg-white/[0.03] p-3">
                      Snooze
                      <span className="mt-1 block text-base font-semibold text-zinc-200">
                        {chore.snooze_minutes} min
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <button
                      className="h-12 rounded-[8px] bg-cyan-300 px-4 font-semibold text-zinc-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() =>
                        void shiftDueDate(
                          chore,
                          chore.interval_minutes,
                          "Chore completed",
                        )
                      }
                      type="button"
                    >
                      {isBusy ? "Saving..." : "Complete"}
                    </button>
                    <button
                      className="h-12 rounded-[8px] border border-white/12 bg-white/5 px-4 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() =>
                        void shiftDueDate(
                          chore,
                          chore.snooze_minutes,
                          "Chore snoozed",
                        )
                      }
                      type="button"
                    >
                      Snooze
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
