import { createClient } from "@supabase/supabase-js";

export type Chore = {
  id: string;
  name: string;
  interval_minutes: number;
  snooze_minutes: number;
  next_due_at: string;
};

type Database = {
  public: {
    Tables: {
      chores: {
        Row: Chore;
        Insert: Omit<Chore, "id"> & { id?: string };
        Update: Partial<Chore>;
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
