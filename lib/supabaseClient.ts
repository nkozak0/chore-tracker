import { createClient } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  display_name: string;
  avatar_color: string;
  points: number;
};

export type Chore = {
  id: string;
  name: string;
  interval_minutes: number;
  snooze_minutes: number;
  next_due_at: string;
  is_paused: boolean;
  last_completed_by: string | null;
  claimed_by: string | null;
};

export type ChoreHistory = {
  id: string;
  chore_id: string;
  profile_id: string;
  action_type: string;
  note: string | null;
  created_at: string;
};

export type PushSubscriptionRecord = {
  id: string;
  endpoint: string;
  auth_key: string;
  p256dh_key: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "points"> & { points?: number };
        Update: Partial<Omit<Profile, "id">>;
        Relationships: [];
      };
      chores: {
        Row: Chore;
        Insert: Omit<Chore, "id"> & { id?: string };
        Update: Partial<Omit<Chore, "id">>;
        Relationships: [];
      };
      chore_history: {
        Row: ChoreHistory;
        Insert: Omit<ChoreHistory, "id" | "created_at" | "note"> & {
          id?: string;
          created_at?: string;
          note?: string | null;
        };
        Update: Partial<Omit<ChoreHistory, "id">>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: PushSubscriptionRecord;
        Insert: Omit<PushSubscriptionRecord, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<PushSubscriptionRecord, "id">>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables.");
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
