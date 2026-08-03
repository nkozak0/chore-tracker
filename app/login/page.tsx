"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Home, LoaderCircle, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/app/components/profile-avatar";
import { selectProfile } from "@/lib/session";
import { supabase } from "@/lib/supabaseClient";
import type { Profile } from "@/lib/supabaseClient";

const profileSelect = "id, display_name, avatar_color, points" as const;

export default function LoginPage() {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("profiles")
      .select(profileSelect)
      .order("display_name", { ascending: true });

    if (loadError) {
      setError(loadError.message);
    } else {
      setProfiles(data ?? []);
      setError(null);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    Promise.resolve().then(loadProfiles);
  }, [loadProfiles]);

  async function chooseProfile(profile: Profile) {
    setSelectingId(profile.id);
    setSelectionError(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      if (!session) {
        const { data, error: signInError } =
          await supabase.auth.signInAnonymously();

        if (signInError) {
          throw signInError;
        }

        if (!data.session || !data.user) {
          throw new Error("Supabase did not return an anonymous session.");
        }
      }

      selectProfile(profile.id);
      router.replace("/");
    } catch (authError) {
      console.error("Anonymous Supabase sign-in failed:", authError);
      setSelectionError(
        authError instanceof Error
          ? authError.message
          : "A secure session could not be started.",
      );
      setSelectingId(null);
    }
  }

  return (
    <main className="login-surface flex min-h-[100svh] items-center justify-center overflow-hidden px-4 py-10 text-white sm:px-6">
      <motion.section
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="relative w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/75 p-5 shadow-[0_32px_100px_rgba(0,0,0,0.65)] backdrop-blur-2xl sm:p-8"
        initial={
          reduceMotion
            ? false
            : { opacity: 0, y: 18, scale: 0.985 }
        }
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />

        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/10 text-cyan-200 shadow-[0_8px_30px_rgba(34,211,238,0.08)]">
            <Home aria-hidden="true" size={22} strokeWidth={1.8} />
          </div>
          <div>
            <p className="text-sm font-medium text-cyan-200">Chore Tracker</p>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
              Who&apos;s home?
            </h1>
            <p className="mt-2 max-w-md text-sm leading-6 text-zinc-400">
              Choose your profile to open the household dashboard.
            </p>
          </div>
        </div>

        <div className="mt-8">
          {isLoading ? (
            <div className="flex min-h-56 items-center justify-center text-zinc-500">
              <LoaderCircle
                aria-label="Loading profiles"
                className="animate-spin"
                size={26}
              />
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 px-5 py-8 text-center">
              <p className="font-medium text-rose-100">
                Profiles could not be loaded
              </p>
              <p className="mt-2 text-sm text-rose-200/60">{error}</p>
              <button
                className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
                onClick={() => {
                  setIsLoading(true);
                  void loadProfiles();
                }}
                type="button"
              >
                Try again
              </button>
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center">
              <Users aria-hidden="true" className="text-zinc-600" size={28} />
              <p className="mt-4 font-medium text-zinc-200">No profiles yet</p>
              <p className="mt-2 max-w-xs text-sm leading-6 text-zinc-500">
                Add a household profile in Supabase, then return here.
              </p>
            </div>
          ) : (
            <>
              <motion.div
                animate="visible"
                className="grid grid-cols-2 gap-3 sm:grid-cols-3"
                initial={reduceMotion ? false : "hidden"}
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.055 } },
                }}
              >
                {profiles.map((profile) => {
                  const isSelecting = selectingId === profile.id;

                  return (
                    <motion.button
                      className="group relative min-h-40 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-left outline-none transition-colors hover:border-white/20 hover:bg-white/[0.065] focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-wait disabled:opacity-60"
                      disabled={selectingId !== null}
                      key={profile.id}
                      onClick={() => void chooseProfile(profile)}
                      type="button"
                      variants={{
                        hidden: { opacity: 0, y: 12 },
                        visible: {
                          opacity: 1,
                          y: 0,
                          transition: {
                            duration: 0.35,
                            ease: [0.22, 1, 0.36, 1],
                          },
                        },
                      }}
                      whileTap={reduceMotion ? undefined : { scale: 0.975 }}
                    >
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute -right-8 -top-8 size-28 rounded-full opacity-15 blur-3xl transition-opacity group-hover:opacity-25"
                        style={{ backgroundColor: profile.avatar_color }}
                      />
                      <ProfileAvatar
                        className="size-14 text-lg"
                        color={profile.avatar_color}
                        name={profile.display_name}
                      />
                      <span className="mt-5 flex items-end justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-white">
                            {profile.display_name}
                          </span>
                          <span className="mt-1 block text-xs text-zinc-500">
                            {profile.points} points
                          </span>
                        </span>
                        {isSelecting ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="mb-0.5 shrink-0 animate-spin text-cyan-200"
                            size={18}
                          />
                        ) : (
                          <ChevronRight
                            aria-hidden="true"
                            className="mb-0.5 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-300"
                            size={18}
                          />
                        )}
                      </span>
                    </motion.button>
                  );
                })}
              </motion.div>
              {selectionError ? (
                <p
                  className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-200"
                  role="alert"
                >
                  {selectionError}
                </p>
              ) : null}
            </>
          )}
        </div>
      </motion.section>
    </main>
  );
}
