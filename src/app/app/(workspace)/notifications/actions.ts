"use server";

import { refresh } from "next/cache";
import { requireMembership } from "@/lib/auth/membership";
import { createClient } from "@/lib/supabase/server";

export async function markAllRead() {
  const m = await requireMembership();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", m.userId)
    .is("read_at", null);
  if (error) throw error;
  refresh();
}
